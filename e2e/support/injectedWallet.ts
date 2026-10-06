/**
 * Injected EIP-1193 wallet for hermetic tests.
 *
 * An init script installs `window.ethereum` that forwards every request to a
 * Node-side handler (exposed via `page.exposeFunction`) closing over the
 * MockWorld. Signing returns canned signatures (the mock gateway never
 * verifies them); sends mutate the world via `applyWrite` and record a receipt
 * the mock chain will serve back.
 */
import type { Page } from "@playwright/test";
import { numberToHex } from "viem";

import { TEST_ADDRESS } from "./constants";
import { applyWrite, handleEthCall } from "./chain";
import { type MockWorld, nextTxHash } from "./world";

/**
 * The canned signature every wallet-side signing method returns. Exported so a
 * spec can tell WHO signed an order: the wallet always yields exactly this,
 * while a session key produces a real secp256k1 signature via viem.
 */
export const WALLET_DUMMY_SIG = ("0x" + "11".repeat(65)) as string;
const DUMMY_SIG = WALLET_DUMMY_SIG;
/** Halves of a canned EIP-7702 authorization; the mock gateway never verifies. */
const DUMMY_R = ("0x" + "22".repeat(32)) as string;
const DUMMY_S = ("0x" + "33".repeat(32)) as string;

interface WalletState {
  connected: boolean;
}

/** Второй кошелёк для `__e2eSwitchAccount`: адрес, отличный от TEST_ADDRESS. */
export const OTHER_WALLET_ADDRESS = "0x00000000000000000000000000000000000000b2";

export async function installWallet(
  page: Page,
  world: MockWorld,
): Promise<WalletState> {
  const state: WalletState = { connected: false };
  /** Адрес, который кошелёк отдаёт сейчас; `__e2eSwitchAccount` его меняет. */
  let account = TEST_ADDRESS.toLowerCase();

  await page.exposeFunction("__e2eSetAccount", (address: string) => {
    account = address.toLowerCase();
  });

  await page.exposeFunction(
    "__e2eWalletRequest",
    async (method: string, params: unknown[]): Promise<unknown> => {
      switch (method) {
        case "eth_chainId":
          return numberToHex(world.chainId);
        case "net_version":
          return String(world.chainId);
        case "eth_requestAccounts":
          if (world.faults.connectRejects) {
            throw new Error("User rejected the request");
          }
          state.connected = true;
          return [account];
        case "eth_accounts":
          return state.connected ? [account] : [];
        case "personal_sign":
        case "eth_sign":
        case "eth_signTypedData":
        case "eth_signTypedData_v4":
          world.signRequests.push(method);
          return DUMMY_SIG;
        case "eth_signAuthorization": {
          // EIP-7702 has no wallet RPC of its own; only our Turnkey provider
          // answers this, and the relay needs it on a user's first batch.
          world.signRequests.push(method);
          const [auth] = (params ?? []) as [
            { address: string; chainId: number; nonce: number },
          ];
          return {
            address: auth.address,
            chainId: auth.chainId,
            nonce: auth.nonce,
            r: DUMMY_R,
            s: DUMMY_S,
            yParity: 0,
          };
        }
        case "eth_sendTransaction": {
          if (world.faults.walletSendRejects) {
            throw new Error("User rejected the request");
          }
          const tx = (params[0] ?? {}) as { to?: string; data?: string };
          const to = (tx.to ?? "").toLowerCase();
          const data = tx.data ?? "0x";
          const hash = nextTxHash(world);
          world.sentTxs.push({ hash, to, data, kind: data.slice(0, 10) });
          world.receipts[hash] = applyWrite(world, to, data);
          return hash;
        }
        case "eth_call": {
          const tx = (params[0] ?? {}) as { to?: string; data?: string };
          return handleEthCall(world, (tx.to ?? "").toLowerCase(), tx.data ?? "0x");
        }
        case "eth_estimateGas":
          return "0x5208";
        case "eth_gasPrice":
        case "eth_maxPriorityFeePerGas":
          return "0x3b9aca00";
        case "eth_getTransactionCount":
          return "0x0";
        case "eth_blockNumber":
          return numberToHex(world.blockNumber);
        case "eth_getBalance":
          return "0x56bc75e2d63100000"; // 100 ETH
        case "wallet_switchEthereumChain": {
          if (world.faults.switchChainRejects) {
            throw new Error("User rejected the request");
          }
          const target = (params[0] ?? {}) as { chainId?: string };
          if (target.chainId) world.chainId = Number.parseInt(target.chainId, 16);
          return null;
        }
        case "wallet_addEthereumChain":
          return null;
        case "wallet_requestPermissions":
        case "wallet_getPermissions":
          return [{ parentCapability: "eth_accounts" }];
        default:
          // Unknown / unused method — null is the most tolerable response.
          return null;
      }
    },
  );

  await page.addInitScript(
    ({ address }) => {
      const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
      const provider = {
        isMetaMask: true,
        isE2E: true,
        // NOTE: deliberately no static `chainId` property — it would go stale
        // after wallet_switchEthereumChain. Consumers (wagmi) read the chain
        // via eth_chainId requests and chainChanged events, both world-backed.
        selectedAddress: address,
        request: async ({
          method,
          params,
        }: {
          method: string;
          params?: unknown[];
        }) => {
          const result = await (
            window as unknown as {
              __e2eWalletRequest: (m: string, p: unknown[]) => Promise<unknown>;
            }
          ).__e2eWalletRequest(method, params ?? []);
          // A successful chain switch must notify wagmi exactly like a real
          // wallet does; a rejected one threw above and emits nothing.
          if (method === "wallet_switchEthereumChain") {
            const target = (params?.[0] ?? {}) as { chainId?: string };
            if (target.chainId)
              for (const fn of listeners["chainChanged"] ?? []) fn(target.chainId);
          }
          return result;
        },
        on(event: string, fn: (...a: unknown[]) => void) {
          (listeners[event] ??= []).push(fn);
          return provider;
        },
        removeListener(event: string, fn: (...a: unknown[]) => void) {
          listeners[event] = (listeners[event] ?? []).filter((f) => f !== fn);
          return provider;
        },
        removeAllListeners() {
          for (const k of Object.keys(listeners)) listeners[k] = [];
          return provider;
        },
      };
      (window as unknown as { ethereum: unknown }).ethereum = provider;

      // Смена аккаунта в кошельке: меняет ответ eth_accounts и, как настоящий
      // кошелёк, шлёт `accountsChanged`.
      (
        window as unknown as {
          __e2eSwitchAccount: (address: string) => Promise<void>;
        }
      ).__e2eSwitchAccount = async (address: string) => {
        await (
          window as unknown as {
            __e2eSetAccount: (a: string) => Promise<void>;
          }
        ).__e2eSetAccount(address);
        for (const fn of listeners["accountsChanged"] ?? [])
          fn([address.toLowerCase()]);
      };

      // EIP-6963 announcement so wagmi's injected discovery finds it too.
      const info = {
        uuid: "11111111-1111-1111-1111-111111111111",
        name: "E2E Wallet",
        icon: "data:image/svg+xml;base64,PHN2Zy8+",
        rdns: "local.e2e.wallet",
      };
      const announce = () =>
        window.dispatchEvent(
          new CustomEvent("eip6963:announceProvider", {
            detail: Object.freeze({ info, provider }),
          }),
        );
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    },
    { address: TEST_ADDRESS.toLowerCase() },
  );

  return state;
}
