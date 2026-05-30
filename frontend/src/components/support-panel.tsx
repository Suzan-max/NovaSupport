"use client";

import { useState, useEffect } from "react";
import { BASE_FEE, Horizon } from "@stellar/stellar-sdk";
import { getNetworkLabel, stellarConfig, horizonServer } from "@/lib/stellar";
import { STELLAR_NETWORK } from "@/lib/config";
import { WalletConnect } from "./wallet-connect";

const FEE_IN_XLM = BASE_FEE / 10_000_000;
const IS_TESTNET = STELLAR_NETWORK !== "PUBLIC";

type SupportPanelProps = {
  walletAddress: string;
};

export function SupportPanel({ walletAddress }: SupportPanelProps) {
  const [visitorAddress, setVisitorAddress] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [assetCode, setAssetCode] = useState("XLM");
  const [balance, setBalance] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [accountNotFound, setAccountNotFound] = useState(false);

  const loadBalance = async (address: string) => {
    if (!address) return;
    setBalanceLoading(true);
    setBalanceError(null);
    setAccountNotFound(false);

    try {
      const account = await horizonServer.loadAccount(address);
      const xlmBalance = account.balances.find(
        (b: any) => b.asset_type === "native"
      );
      setBalance(xlmBalance ? xlmBalance.balance : "0");
    } catch (err: any) {
      if (err?.response?.status === 404 || err instanceof Horizon.NotFoundError) {
        setAccountNotFound(true);
        setBalance("0");
        if (!IS_TESTNET) {
          setBalanceError("Account not found on Stellar network");
        }
      } else {
        setBalanceError("Failed to load balance");
      }
    } finally {
      setBalanceLoading(false);
    }
  };

  useEffect(() => {
    if (visitorAddress) {
      loadBalance(visitorAddress);
    }
  }, [visitorAddress]);

  const parsedAmount = parseFloat(amount);
  const hasValidAmount = !isNaN(parsedAmount) && parsedAmount > 0;
  const parsedBalance = balance ? parseFloat(balance) : 0;
  const totalNeeded = hasValidAmount ? parsedAmount + FEE_IN_XLM : 0;
  const insufficientBalance = hasValidAmount && totalNeeded > parsedBalance;

  if (!visitorAddress) {
    return (
      <section className="rounded-[2rem] border border-gold/25 bg-gold/10 p-7 text-center">
        <p className="mb-4 text-sm text-sky/85">
          Connect your Freighter wallet to support this creator.
        </p>
        <WalletConnect onConnect={setVisitorAddress} />
      </section>
    );
  }

  return (
    <section className="rounded-[2rem] border border-gold/25 bg-gold/10 p-7">
      <p className="text-xs uppercase tracking-[0.25em] text-gold">Support</p>
      <h2 className="mt-3 text-2xl font-semibold text-white">Send Support</h2>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-3xl border border-white/10 bg-ink/40 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-sky/70">Network</p>
          <p className="mt-2 font-semibold text-white">{getNetworkLabel()}</p>
        </div>
        <div className="rounded-3xl border border-white/10 bg-ink/40 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-sky/70">Horizon</p>
          <p className="mt-2 break-all text-sm text-white">{stellarConfig.horizonUrl}</p>
        </div>
        <div className="rounded-3xl border border-white/10 bg-ink/40 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-sky/70">Recipient</p>
          <p className="mt-2 break-all text-sm text-white">{walletAddress}</p>
        </div>
      </div>

      {accountNotFound && IS_TESTNET && (
        <div className="mt-4 rounded-2xl border border-gold/20 bg-gold/5 p-4">
          <p className="text-sm text-sky/85">
            Your account isn&apos;t funded on Testnet yet.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <a
              href={`https://friendbot.stellar.org/?addr=${visitorAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-mint px-4 py-2 text-xs font-semibold text-black hover:bg-mint/90 transition-colors"
            >
              Fund with Friendbot &rarr;
            </a>
            <button
              onClick={() => loadBalance(visitorAddress)}
              disabled={balanceLoading}
              className="rounded-lg bg-white/5 px-4 py-2 text-xs font-semibold text-steel hover:bg-white/10 transition-colors disabled:opacity-50"
            >
              {balanceLoading ? "Refreshing..." : "Refresh balance"}
            </button>
          </div>
        </div>
      )}

      {accountNotFound && !IS_TESTNET && (
        <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/5 p-4">
          <p className="text-sm text-red-400">
            Account not found on Stellar network
          </p>
        </div>
      )}

      {balanceError && !accountNotFound && (
        <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/5 p-4">
          <p className="text-sm text-red-400">{balanceError}</p>
          <button
            onClick={() => loadBalance(visitorAddress)}
            disabled={balanceLoading}
            className="mt-2 rounded-lg bg-white/5 px-3 py-1 text-xs font-semibold text-steel hover:bg-white/10 transition-colors disabled:opacity-50"
          >
            {balanceLoading ? "Refreshing..." : "Refresh balance"}
          </button>
        </div>
      )}

      {!accountNotFound && balance !== null && (
        <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-[0.2em] text-sky/70">Your Balance</p>
            <button
              onClick={() => loadBalance(visitorAddress)}
              disabled={balanceLoading}
              className="text-[10px] uppercase tracking-wider text-steel hover:text-white transition-colors disabled:opacity-50"
            >
              {balanceLoading ? "..." : "Refresh"}
            </button>
          </div>
          <p className="mt-1 text-lg font-semibold text-white tabular-nums">
            {parseFloat(balance).toFixed(7)} XLM
          </p>
        </div>
      )}

      <div className="mt-6 space-y-4">
        <div>
          <label className="text-xs font-semibold text-steel uppercase tracking-wider">
            Amount
          </label>
          <div className="mt-2 flex gap-2">
            <input
              type="number"
              step="0.0000001"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="flex-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-steel/50 focus:outline-none focus:border-mint/50"
            />
            <select
              value={assetCode}
              onChange={(e) => setAssetCode(e.target.value)}
              className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:border-mint/50"
            >
              <option value="XLM">XLM</option>
              <option value="USDC">USDC</option>
              <option value="AQUA">AQUA</option>
            </select>
          </div>
        </div>

        {hasValidAmount && (
          <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-3">
            <div className="flex items-center justify-between text-xs text-steel">
              <span>Network fee</span>
              <span className="tabular-nums">~{FEE_IN_XLM.toFixed(7)} XLM</span>
            </div>
            {assetCode !== "XLM" && (
              <p className="mt-1 text-[10px] text-steel/60">
                Path payments may incur slightly higher fees due to additional operations
              </p>
            )}
          </div>
        )}

        {insufficientBalance && (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-3">
            <p className="text-xs text-red-400">
              Insufficient balance. You need at least {totalNeeded.toFixed(7)} XLM
              (including ~{FEE_IN_XLM.toFixed(7)} XLM network fee).
            </p>
          </div>
        )}

        <button
          type="button"
          disabled={!hasValidAmount || insufficientBalance}
          className="w-full rounded-lg bg-mint px-4 py-3 text-sm font-semibold text-black hover:bg-mint/90 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Send Support
        </button>
      </div>

      <p className="mt-4 text-xs leading-6 text-steel">
        This builds and signs a Stellar payment using Freighter.
        The transaction hash is stored on the NovaSupport backend.
      </p>
    </section>
  );
}
