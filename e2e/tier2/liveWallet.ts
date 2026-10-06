/**
 * Live injected wallet for Tier 2: a real viem account (derived from the test
 * mnemonic) signs SIWE messages + EIP-712 orders and submits real transactions
 * to the real RPC; all other RPC reads are forwarded to a real public client.
 * `isMetaMask:false` keeps wagmi's injected connector from deferring to a
 * (non-existent) MetaMask extension.
 */
import type { Page } from "@playwright/test";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  numberToHex,
  type Hex,
  type HDAccount,
} from "viem";

export async function installLiveWallet(
  page: Page,
  account: HDAccount,
  rpcUrl: string,
  chainId: number,
): Promise<void> {
  const chain = defineChain({
    id: chainId,
    name: "MegaETH Testnet",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    testnet: true,
  });
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
  const pub = createPublicClient({ chain, transport: http(rpcUrl) });
  let connected = false;

  await page.exposeFunction(
    "__liveWalletRequest",
    async (method: string, params: unknown[]): Promise<unknown> => {
      switch (method) {
        case "eth_requestAccounts":
          connected = true;
          return [account.address];
        case "eth_accounts":
          return connected ? [account.address] : [];
        case "eth_chainId":
          return numberToHex(chainId);
        case "personal_sign": {
          const [message] = params as [Hex];
          return wallet.signMessage({ account, message: { raw: message } });
        }
        case "eth_signTypedData":
        case "eth_signTypedData_v4": {
          const [, typedData] = params as [string, string];
          const parsed = JSON.parse(typedData) as {
            domain: Record<string, unknown>;
            types: Record<string, { name: string; type: string }[]>;
            primaryType: string;
            message: Record<string, unknown>;
          };
          const types = { ...parsed.types };
          delete types.EIP712Domain; // viem derives the domain separately

          // eth_signTypedData_v4 carries every numeric field as a JSON string,
          // but viem's signTypedData hashes the string differently from the
          // bigint it represents — signing the raw parsed message yields a hash
          // that recovers the WRONG signer (gateway: INVALID_SIGNATURE "Unknown
          // signer"). Coerce numeric fields back to bigint per the type schema
          // (and domain.chainId) so the injected wallet signs the canonical
          // EIP-712 hash, exactly as a real wallet would.
          const isNumeric = (t: string) => /^u?int\d*$/.test(t);
          const coerce = (
            typeName: string,
            value: Record<string, unknown>,
          ): Record<string, unknown> => {
            const out: Record<string, unknown> = {};
            for (const field of types[typeName] ?? []) {
              const v = value[field.name];
              if (isNumeric(field.type)) out[field.name] = BigInt(v as string);
              else if (types[field.type] && v && typeof v === "object")
                out[field.name] = coerce(
                  field.type,
                  v as Record<string, unknown>,
                );
              else out[field.name] = v;
            }
            return out;
          };
          const domain = { ...parsed.domain };
          if (domain.chainId !== undefined)
            domain.chainId = BigInt(domain.chainId as string);

          return wallet.signTypedData({
            account,
            domain,
            types: types as never,
            primaryType: parsed.primaryType as never,
            message: coerce(parsed.primaryType, parsed.message),
          });
        }
        case "eth_sendTransaction": {
          const [tx] = params as [
            { to?: Hex; data?: Hex; value?: Hex; gas?: Hex },
          ];
          return wallet.sendTransaction({
            account,
            chain,
            to: tx.to,
            data: tx.data,
            value: tx.value ? BigInt(tx.value) : undefined,
            gas: tx.gas ? BigInt(tx.gas) : undefined,
          });
        }
        case "wallet_switchEthereumChain":
        case "wallet_addEthereumChain":
          return null;
        default:
          return pub.request({ method, params } as never);
      }
    },
  );

  await page.addInitScript(
    ({ address }) => {
      const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
      const provider = {
        isMetaMask: false,
        isE2E: true,
        chainId: "0x18c7",
        selectedAddress: address,
        request: ({ method, params }: { method: string; params?: unknown[] }) =>
          (
            window as unknown as {
              __liveWalletRequest: (m: string, p: unknown[]) => Promise<unknown>;
            }
          ).__liveWalletRequest(method, params ?? []),
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
      const info = {
        uuid: "22222222-2222-2222-2222-222222222222",
        name: "E2E Live Wallet",
        icon: "data:image/svg+xml;base64,PHN2Zy8+",
        rdns: "local.e2e.livewallet",
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
    { address: account.address },
  );
}
