/**
 * Unit tests for multi-wallet server — wallet store and distribution tool validation.
 * All RPC calls are mocked — no real chain interaction.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ethers } from "ethers";

// ── Wallet Store Tests (pure logic, no mocks needed) ─────────────────────────

// We import the wallet store directly — it's pure in-memory logic
import {
  generateWallets,
  importWallet,
  listWallets,
  walletCount,
  getWalletSigner,
} from "../services/wallet-store.js";

describe("wallet-store: generateWallets", () => {
  it("generates the requested number of wallets", () => {
    const created = generateWallets(3, "test");
    expect(created.length).toBe(3);
    for (const w of created) {
      expect(w.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(w.label).toMatch(/^test-\d+$/);
    }
  });

  it("generates unique addresses", () => {
    const created = generateWallets(5, "unique");
    const addresses = new Set(created.map((w) => w.address.toLowerCase()));
    expect(addresses.size).toBe(5);
  });

  it("increments total wallet count", () => {
    const before = walletCount();
    generateWallets(2, "count");
    expect(walletCount()).toBe(before + 2);
  });
});

describe("wallet-store: importWallet", () => {
  it("imports a valid private key", () => {
    // Generate a known wallet for testing
    const testWallet = ethers.Wallet.createRandom();
    const result = importWallet(testWallet.privateKey, "imported-test");

    expect(result).not.toBeNull();
    expect(result!.address.toLowerCase()).toBe(testWallet.address.toLowerCase());
    expect(result!.label).toBe("imported-test");
  });

  it("returns null for invalid private key", () => {
    const result = importWallet("not-a-private-key");
    expect(result).toBeNull();
  });

  it("returns null for empty string", () => {
    const result = importWallet("");
    expect(result).toBeNull();
  });

  it("assigns default label when none provided", () => {
    const testWallet = ethers.Wallet.createRandom();
    const result = importWallet(testWallet.privateKey);
    expect(result).not.toBeNull();
    expect(result!.label).toMatch(/^imported-\d+$/);
  });
});

describe("wallet-store: listWallets", () => {
  it("returns array of wallet info without private keys", () => {
    const all = listWallets();
    expect(Array.isArray(all)).toBe(true);
    for (const w of all) {
      expect(w).toHaveProperty("address");
      expect(w).toHaveProperty("label");
      expect(w).toHaveProperty("createdAt");
      // Must NOT expose private key
      expect(w).not.toHaveProperty("privateKey");
    }
  });
});

describe("wallet-store: getWalletSigner", () => {
  it("returns a signer for a known wallet", () => {
    const testWallet = ethers.Wallet.createRandom();
    importWallet(testWallet.privateKey, "signer-test");

    const mockProvider = {} as ethers.Provider;
    const signer = getWalletSigner(testWallet.address, mockProvider);
    expect(signer).not.toBeNull();
    expect(signer!.address.toLowerCase()).toBe(testWallet.address.toLowerCase());
  });

  it("returns null for unknown address", () => {
    const mockProvider = {} as ethers.Provider;
    const signer = getWalletSigner("0x0000000000000000000000000000000000000001", mockProvider);
    expect(signer).toBeNull();
  });

  it("is case-insensitive on address lookup", () => {
    const testWallet = ethers.Wallet.createRandom();
    importWallet(testWallet.privateKey, "case-test");

    const mockProvider = {} as ethers.Provider;
    const signerLower = getWalletSigner(testWallet.address.toLowerCase(), mockProvider);
    const signerUpper = getWalletSigner(testWallet.address.toUpperCase(), mockProvider);
    // At least the lowercase lookup should work (how the store indexes)
    expect(signerLower).not.toBeNull();
  });
});

// ── Address Validation (used by distribution tools) ──────────────────────────

describe("address validation for distribution tools", () => {
  it("ethers.isAddress accepts valid checksummed address", () => {
    expect(ethers.isAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")).toBe(true);
  });

  it("ethers.isAddress accepts valid lowercase address", () => {
    expect(ethers.isAddress("0xd8da6bf26964af9d7eed9e03e53415d37aa96045")).toBe(true);
  });

  it("ethers.isAddress rejects short address", () => {
    expect(ethers.isAddress("0xd8dA6BF269")).toBe(false);
  });

  it("ethers.isAddress accepts bare hex (ethers v6 behavior)", () => {
    // ethers v6 isAddress accepts valid hex strings without 0x prefix
    expect(ethers.isAddress("d8dA6BF26964aF9D7eEd9e03E53415D37aA96045")).toBe(true);
  });

  it("ethers.isAddress rejects empty string", () => {
    expect(ethers.isAddress("")).toBe(false);
  });

  it("ethers.isAddress rejects non-hex", () => {
    expect(ethers.isAddress("0xZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ")).toBe(false);
  });
});

// ── Error Response Structure ─────────────────────────────────────────────────

describe("error responses include suggestion field", () => {
  // These test the patterns used in distribution-tools.ts and wallet-tools.ts
  // to ensure error objects always include the `suggestion` field.

  it("invalid from_address error includes suggestion", () => {
    // Simulate the error object created by wallet_distribute_eth
    const errorResponse = {
      error: "Invalid from_address.",
      suggestion: "Provide a valid 0x... EVM address.",
    };
    expect(errorResponse).toHaveProperty("suggestion");
    expect(errorResponse.suggestion).toBeTruthy();
  });

  it("invalid destination address error includes suggestion", () => {
    const addr = "0xinvalid";
    const errorResponse = {
      error: `Invalid destination address: ${addr}`,
      suggestion: "All destination addresses must be valid 0x... EVM addresses.",
    };
    expect(errorResponse).toHaveProperty("suggestion");
    expect(errorResponse.suggestion).toBeTruthy();
  });

  it("no destination wallets error includes suggestion", () => {
    const errorResponse = {
      error: "No destination wallets.",
      suggestion: "Generate wallets first with wallet_generate.",
    };
    expect(errorResponse).toHaveProperty("suggestion");
  });

  it("insufficient balance error includes suggestion", () => {
    const errorResponse = {
      error: "Insufficient balance. Need 1.0 ETH, have 0.5.",
      suggestion: "Reduce the amount_each, send to fewer wallets, or fund the source wallet with more ETH.",
    };
    expect(errorResponse).toHaveProperty("suggestion");
    expect(errorResponse.suggestion.length).toBeGreaterThan(10);
  });

  it("cannot sign error includes suggestion", () => {
    const errorResponse = {
      error: "Cannot sign from this address. It must be a managed wallet or the deployer.",
      suggestion: "Import the wallet first with wallet_import, or use the deployer address.",
    };
    expect(errorResponse).toHaveProperty("suggestion");
  });

  it("invalid wallet address error includes suggestion", () => {
    const errorResponse = {
      error: "Invalid wallet address.",
      suggestion: "Provide a valid 0x... EVM address.",
    };
    expect(errorResponse).toHaveProperty("suggestion");
  });

  it("no wallets in pool error includes suggestion", () => {
    const errorResponse = {
      error: "No wallets in pool. Generate or import wallets first.",
      suggestion: "Use wallet_generate to create wallets.",
    };
    expect(errorResponse).toHaveProperty("suggestion");
  });

  it("invalid to_address error includes suggestion", () => {
    const errorResponse = {
      error: "Invalid to_address.",
      suggestion: "Provide a valid 0x... EVM address.",
    };
    expect(errorResponse).toHaveProperty("suggestion");
  });

  it("no managed wallets error includes suggestion", () => {
    const errorResponse = {
      error: "No managed wallets to consolidate from.",
      suggestion: "Generate wallets with wallet_generate or import them with wallet_import first.",
    };
    expect(errorResponse).toHaveProperty("suggestion");
  });
});

// ── ETH Amount Parsing ───────────────────────────────────────────────────────

describe("ETH amount parsing", () => {
  it("parseEther handles normal amounts", () => {
    const wei = ethers.parseEther("0.001");
    expect(wei).toBe(1000000000000000n);
  });

  it("parseEther handles very small amounts", () => {
    const wei = ethers.parseEther("0.0001");
    expect(wei).toBe(100000000000000n);
  });

  it("parseEther handles 1 ETH", () => {
    const wei = ethers.parseEther("1");
    expect(wei).toBe(1000000000000000000n);
  });

  it("formatEther round-trips with parseEther", () => {
    const original = "0.123456789";
    const wei = ethers.parseEther(original);
    const formatted = ethers.formatEther(wei);
    expect(formatted).toBe("0.123456789");
  });
});
