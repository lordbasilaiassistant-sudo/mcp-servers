/**
 * Vulnerability pattern database for Solidity smart contract scanning.
 *
 * Based on SWC registry, common audit findings, and real-world exploits.
 * Each pattern includes source-level regex and/or bytecode signature matching.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export interface VulnPattern {
  id: string;
  name: string;
  severity: Severity;
  category: string;
  /** Regex to match against Solidity source code */
  sourceRegex?: RegExp;
  /** Hex string to match against contract bytecode (4-byte selectors or opcode sequences) */
  bytecodeSignature?: string;
  description: string;
  recommendation: string;
}

export interface Finding {
  patternId: string;
  name: string;
  severity: Severity;
  category: string;
  description: string;
  recommendation: string;
  /** Line number in source where pattern was found (source-only) */
  lineNumber?: number;
  /** Matched source code snippet */
  matchedText?: string;
}

// ── Vulnerability Patterns ───────────────────────────────────────────────────

export const VULN_PATTERNS: VulnPattern[] = [
  // ─── Critical ──────────────────────────────────────────────────────────────
  {
    id: "SWC-107",
    name: "Reentrancy",
    severity: "critical",
    category: "reentrancy",
    sourceRegex: /\.call\{[^}]*value[^}]*\}\s*\([^)]*\)\s*;[^}]*[a-zA-Z_]\w*(?:\[[^\]]*\])*\s*[\-+]?=/,
    description: "External call with value transfer before state update. Classic reentrancy vulnerability — attacker can re-enter the function before state is updated.",
    recommendation: "Apply checks-effects-interactions pattern: update state BEFORE external calls. Use ReentrancyGuard from OpenZeppelin.",
  },
  {
    id: "SWC-107-SEND",
    name: "Reentrancy via send/transfer",
    severity: "high",
    category: "reentrancy",
    sourceRegex: /\.(send|transfer)\s*\([^)]*\)\s*;[^}]*[a-zA-Z_]\w*\s*[\-+]?=/,
    description: "ETH transfer via send/transfer before state update. While send/transfer have a 2300 gas limit, this is still a reentrancy risk pattern.",
    recommendation: "Update state before transfers. Use the checks-effects-interactions pattern.",
  },
  {
    id: "SCANNER-001",
    name: "Unrestricted selfdestruct",
    severity: "critical",
    category: "access-control",
    sourceRegex: /selfdestruct\s*\(/,
    bytecodeSignature: "ff",
    description: "Contract contains selfdestruct opcode. If callable by unauthorized parties, the entire contract can be destroyed and funds stolen.",
    recommendation: "Remove selfdestruct if possible. If needed, restrict to owner with a timelock.",
  },
  {
    id: "SWC-112",
    name: "Delegatecall to untrusted callee",
    severity: "critical",
    category: "delegatecall",
    sourceRegex: /\.delegatecall\s*\(/,
    bytecodeSignature: "f4",
    description: "Delegatecall executes code in the context of the calling contract. If the target is user-controlled, an attacker can overwrite storage and steal funds.",
    recommendation: "Never delegatecall to user-supplied addresses. Use well-audited proxy patterns (EIP-1967).",
  },
  {
    id: "SCANNER-002",
    name: "Hidden mint function",
    severity: "critical",
    category: "token-risk",
    sourceRegex: /function\s+(?!_)(\w*[Mm]int\w*)\s*\([^)]*\)[^{]*\{/,
    bytecodeSignature: "40c10f19",
    description: "Contract has a mint function that can create new tokens. If access control is weak, the owner can inflate supply and dump on holders.",
    recommendation: "Verify mint function has proper access control. For fair-launch tokens, mint should be disabled after initial distribution.",
  },

  // ─── High ──────────────────────────────────────────────────────────────────
  {
    id: "SWC-101",
    name: "Integer overflow/underflow",
    severity: "high",
    category: "arithmetic",
    sourceRegex: /pragma\s+solidity\s+[\^~>=<]*\s*0\.[0-7]\.\d+/,
    description: "Contract uses Solidity <0.8.0 which does not have built-in overflow checks. Arithmetic operations can silently wrap around.",
    recommendation: "Upgrade to Solidity >=0.8.0 or use OpenZeppelin SafeMath for all arithmetic.",
  },
  {
    id: "SWC-100",
    name: "Unchecked external call return",
    severity: "high",
    category: "unchecked-calls",
    sourceRegex: /\.call\{[^}]*\}\s*\([^)]*\)\s*;(?!\s*(?:require|if|assert|bool|,))/,
    description: "External call return value is not checked. The call could silently fail, leading to inconsistent state.",
    recommendation: "Always check the return value: (bool success, ) = addr.call{...}(...); require(success);",
  },
  {
    id: "SCANNER-003",
    name: "Blacklist/blocklist function",
    severity: "high",
    category: "token-risk",
    sourceRegex: /function\s+\w*(blacklist|blocklist|block|ban|restrict)\w*\s*\(/i,
    bytecodeSignature: "44337ea1",
    description: "Contract can blacklist addresses, preventing them from transferring tokens. Owner can freeze your funds.",
    recommendation: "Avoid tokens with blacklist functions unless they are regulated stablecoins (USDC, USDT).",
  },
  {
    id: "SCANNER-004",
    name: "Pause function",
    severity: "high",
    category: "token-risk",
    sourceRegex: /function\s+\w*[Pp]ause\w*\s*\(/,
    bytecodeSignature: "8456cb59",
    description: "Contract can be paused, halting all transfers. Owner has a kill switch on the token.",
    recommendation: "Check if pause is owner-only and if the contract has a timelock. High risk for tokens without timelock governance.",
  },
  {
    id: "SCANNER-005",
    name: "Proxy/upgradeable contract",
    severity: "high",
    category: "proxy",
    sourceRegex: /(?:TransparentUpgradeableProxy|UUPSUpgradeable|ERC1967|upgradeTo|_implementation)/,
    bytecodeSignature: "5c60da1b",
    description: "Contract uses a proxy pattern — the logic can be changed by the admin. The current code you see could be replaced with malicious code at any time.",
    recommendation: "Check proxy admin address. Is it a multisig? Is there a timelock? If admin is a single EOA, this is very risky.",
  },

  // ─── Medium ────────────────────────────────────────────────────────────────
  {
    id: "SWC-115",
    name: "tx.origin authentication",
    severity: "medium",
    category: "access-control",
    sourceRegex: /tx\.origin/,
    description: "Uses tx.origin for authentication. This is vulnerable to phishing attacks where a malicious contract forwards calls from the legitimate user.",
    recommendation: "Use msg.sender instead of tx.origin for access control.",
  },
  {
    id: "SWC-105",
    name: "Unprotected ether withdrawal",
    severity: "medium",
    category: "access-control",
    sourceRegex: /function\s+\w*(?:withdraw|drain|sweep|claim)\w*\s*\([^)]*\)\s*(?:external|public)(?!\s+(?:onlyOwner|onlyAdmin|only))/,
    description: "Public/external withdrawal function without apparent access modifier. Anyone might be able to drain contract funds.",
    recommendation: "Add access control (onlyOwner or role-based) to all withdrawal functions.",
  },
  {
    id: "SCANNER-006",
    name: "Fee-on-transfer pattern",
    severity: "medium",
    category: "token-risk",
    sourceRegex: /(?:_?(?:tax|fee|commission)(?:Rate|Percent|Bps)?|(?:buy|sell|transfer)(?:Tax|Fee))\s*[=;]/i,
    description: "Contract applies fees on token transfers. Token amount received differs from amount sent — can break DeFi integrations and is commonly used in rug pulls.",
    recommendation: "Check fee percentages. If >5%, likely a scam. Verify fees cannot be changed to 100% by the owner.",
  },
  {
    id: "SCANNER-007",
    name: "Hardcoded address (potential backdoor)",
    severity: "medium",
    category: "backdoor",
    sourceRegex: /address\s+(?:public\s+|private\s+|internal\s+)?(?:constant\s+)?\w+\s*=\s*(?:address\s*\()?0x[a-fA-F0-9]{40}/,
    description: "Contract contains hardcoded addresses. These could be legitimate (router, WETH) or backdoors for fee collection, hidden minting, or fund extraction.",
    recommendation: "Verify all hardcoded addresses. Known routers (Uniswap, Aerodrome) are fine. Unknown addresses are red flags.",
  },
  {
    id: "SCANNER-008",
    name: "Unlimited token approval",
    severity: "medium",
    category: "approval-risk",
    sourceRegex: /approve\s*\([^,]+,\s*(?:type\s*\(\s*uint256\s*\)\s*\.max|2\s*\*\*\s*256\s*-\s*1|~uint256\s*\(\s*0\s*\)|0xffffffff)/,
    description: "Contract grants unlimited token approval to an address. If that address is compromised, all approved tokens can be drained.",
    recommendation: "Use exact approval amounts instead of max uint256. Revoke unused approvals.",
  },
  {
    id: "SWC-116",
    name: "Block timestamp manipulation",
    severity: "medium",
    category: "timestamp",
    sourceRegex: /block\.timestamp\s*(?:[<>=!]+|==)/,
    description: "Contract logic depends on block.timestamp for critical decisions. Miners can manipulate timestamps by ~15 seconds.",
    recommendation: "Don't use block.timestamp for precise timing. For randomness, use Chainlink VRF.",
  },
  {
    id: "SCANNER-009",
    name: "Missing zero-address check",
    severity: "medium",
    category: "input-validation",
    sourceRegex: /function\s+(?:set|update|change)\w*(?:Owner|Admin|Receiver|Wallet)\s*\(\s*address\s+\w+\s*\)[^{]*\{(?:(?!require\s*\(\s*\w+\s*!=\s*address\s*\(\s*0\s*\)).)*\}/s,
    description: "Function that sets a critical address (owner, admin, receiver) does not check for zero address. Accidentally setting to 0x0 can lock the contract permanently.",
    recommendation: "Add require(newAddress != address(0)) to all address setter functions.",
  },

  // ─── Low ───────────────────────────────────────────────────────────────────
  {
    id: "SWC-103",
    name: "Floating pragma",
    severity: "low",
    category: "best-practice",
    sourceRegex: /pragma\s+solidity\s+\^/,
    description: "Contract uses a floating pragma (^). Different compiler versions may produce different bytecode, making verification harder and potentially introducing bugs.",
    recommendation: "Lock the pragma to a specific version: pragma solidity 0.8.20;",
  },
  {
    id: "SWC-108",
    name: "State variable default visibility",
    severity: "low",
    category: "visibility",
    sourceRegex: /(?:uint|int|bool|address|string|bytes|mapping)\s+(?!public\b|private\b|internal\b|external\b|constant\b|immutable\b)\w+\s*[;=]/,
    description: "State variable declared without explicit visibility. Defaults to internal, which may not be intended.",
    recommendation: "Always specify visibility explicitly: public, private, or internal.",
  },
  {
    id: "SCANNER-010",
    name: "Missing event emission",
    severity: "low",
    category: "best-practice",
    sourceRegex: /function\s+(?:set|update|change|transfer)\w*\s*\([^)]*\)[^{]*\{(?:(?!emit\s+).)*\}/s,
    description: "State-changing function does not emit an event. Events are essential for off-chain monitoring and transparency.",
    recommendation: "Emit events for all state-changing operations.",
  },

  // ─── Info ──────────────────────────────────────────────────────────────────
  {
    id: "SCANNER-011",
    name: "Ownership not renounced",
    severity: "info",
    category: "ownership",
    sourceRegex: /(?:Ownable|onlyOwner)/,
    bytecodeSignature: "8da5cb5b",
    description: "Contract has an owner with special privileges. This is standard but means the owner has elevated control.",
    recommendation: "Check owner address. Multisig + timelock is ideal. Single EOA owner is a centralization risk.",
  },
  {
    id: "SCANNER-012",
    name: "Uses OpenZeppelin",
    severity: "info",
    category: "dependencies",
    sourceRegex: /@openzeppelin\//,
    description: "Contract imports OpenZeppelin libraries — a well-audited and widely used smart contract library. This is a positive signal.",
    recommendation: "Verify the OpenZeppelin version is up to date. Check for known vulnerabilities in that version.",
  },
];

// ── Bytecode-only patterns (no source needed) ────────────────────────────────

/** 4-byte function selectors for common dangerous functions */
export const DANGEROUS_SELECTORS: Record<string, { name: string; risk: string }> = {
  "40c10f19": { name: "mint(address,uint256)", risk: "Owner can create unlimited tokens" },
  "8456cb59": { name: "pause()", risk: "Owner can freeze all transfers" },
  "3f4ba83a": { name: "unpause()", risk: "Paired with pause — indicates pausable contract" },
  "44337ea1": { name: "blacklistAddress(address)", risk: "Owner can block specific wallets" },
  "e4997dc5": { name: "excludeFromFees(address,bool)", risk: "Owner can exempt addresses from fees" },
  "f2fde38b": { name: "transferOwnership(address)", risk: "Owner can transfer control" },
  "715018a6": { name: "renounceOwnership()", risk: "Owner can renounce (positive if called)" },
  "a9059cbb": { name: "transfer(address,uint256)", risk: "Standard ERC-20 — expected" },
  "095ea7b3": { name: "approve(address,uint256)", risk: "Standard ERC-20 — expected" },
  "23b872dd": { name: "transferFrom(address,address,uint256)", risk: "Standard ERC-20 — expected" },
  "5c60da1b": { name: "implementation()", risk: "Proxy pattern — logic can be upgraded" },
  "3659cfe6": { name: "upgradeTo(address)", risk: "Proxy upgrade function" },
  "4f1ef286": { name: "upgradeToAndCall(address,bytes)", risk: "Proxy upgrade with initialization" },
  "8f283970": { name: "changeAdmin(address)", risk: "Proxy admin change" },
  "3ccfd60b": { name: "withdraw()", risk: "Withdrawal function — check access control" },
  "51cff8d9": { name: "withdraw(address)", risk: "Withdrawal to specific address" },
  "e8078d94": { name: "enableTrading()", risk: "Trading not enabled by default — potential honeypot setup" },
  "c9567bf9": { name: "openTrading()", risk: "Same as enableTrading — delayed trading start" },
};

/** Opcodes of interest in bytecode */
export const OPCODE_PATTERNS: Record<string, { name: string; significance: string }> = {
  ff: { name: "SELFDESTRUCT", significance: "Contract can be destroyed" },
  f4: { name: "DELEGATECALL", significance: "Executes external code in this contract's context" },
  f2: { name: "CALLCODE", significance: "Deprecated — similar to delegatecall, potential risk" },
  fa: { name: "STATICCALL", significance: "Read-only external call — safe" },
};

// ── Common function selectors for calldata decoding ──────────────────────────

export const COMMON_SELECTORS: Record<string, { signature: string; dangerous: boolean; description: string }> = {
  // ERC-20
  "a9059cbb": { signature: "transfer(address,uint256)", dangerous: false, description: "Transfer tokens to an address" },
  "095ea7b3": { signature: "approve(address,uint256)", dangerous: true, description: "Approve an address to spend your tokens. DANGEROUS if amount is unlimited." },
  "23b872dd": { signature: "transferFrom(address,address,uint256)", dangerous: false, description: "Transfer tokens on behalf of another address (requires approval)" },
  "70a08231": { signature: "balanceOf(address)", dangerous: false, description: "Check token balance of an address" },
  "dd62ed3e": { signature: "allowance(address,address)", dangerous: false, description: "Check how many tokens an address is approved to spend" },

  // ERC-721
  "42842e0e": { signature: "safeTransferFrom(address,address,uint256)", dangerous: false, description: "Transfer NFT safely" },
  "b88d4fde": { signature: "safeTransferFrom(address,address,uint256,bytes)", dangerous: false, description: "Transfer NFT safely with data" },
  "a22cb465": { signature: "setApprovalForAll(address,bool)", dangerous: true, description: "Approve operator for ALL your NFTs. DANGEROUS — grants full control." },

  // Uniswap V2 Router
  "38ed1739": { signature: "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)", dangerous: false, description: "Swap exact token amount for tokens via Uniswap V2" },
  "8803dbee": { signature: "swapTokensForExactTokens(uint256,uint256,address[],address,uint256)", dangerous: false, description: "Swap tokens for exact output amount via Uniswap V2" },
  "7ff36ab5": { signature: "swapExactETHForTokens(uint256,address[],address,uint256)", dangerous: false, description: "Swap exact ETH for tokens via Uniswap V2" },
  "18cbafe5": { signature: "swapExactTokensForETH(uint256,uint256,address[],address,uint256)", dangerous: false, description: "Swap exact tokens for ETH via Uniswap V2" },
  "fb3bdb41": { signature: "swapETHForExactTokens(uint256,address[],address,uint256)", dangerous: false, description: "Swap ETH for exact token amount" },
  "e8e33700": { signature: "addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256)", dangerous: false, description: "Add liquidity to a pair" },
  "f305d719": { signature: "addLiquidityETH(address,uint256,uint256,uint256,address,uint256)", dangerous: false, description: "Add liquidity with ETH" },
  "baa2abde": { signature: "removeLiquidity(address,address,uint256,uint256,uint256,address,uint256)", dangerous: false, description: "Remove liquidity from a pair" },
  "02751cec": { signature: "removeLiquidityETH(address,uint256,uint256,uint256,address,uint256)", dangerous: false, description: "Remove liquidity and receive ETH" },

  // Uniswap V3
  "414bf389": { signature: "exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))", dangerous: false, description: "Uniswap V3 exact input single swap" },
  "c04b8d59": { signature: "exactInput((bytes,address,uint256,uint256,uint256))", dangerous: false, description: "Uniswap V3 exact input multi-hop swap" },
  "5023b4df": { signature: "exactOutputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))", dangerous: false, description: "Uniswap V3 exact output single swap" },

  // Dangerous operations
  "40c10f19": { signature: "mint(address,uint256)", dangerous: true, description: "Mint new tokens — only safe if you're the authorized minter" },
  "42966c68": { signature: "burn(uint256)", dangerous: true, description: "Burn tokens permanently" },
  "f2fde38b": { signature: "transferOwnership(address)", dangerous: true, description: "Transfer contract ownership — irreversible" },
  "715018a6": { signature: "renounceOwnership()", dangerous: true, description: "Renounce ownership permanently — cannot be undone" },
  "8456cb59": { signature: "pause()", dangerous: true, description: "Pause contract operations" },
  "3f4ba83a": { signature: "unpause()", dangerous: true, description: "Unpause contract operations" },

  // Multicall
  "ac9650d8": { signature: "multicall(bytes[])", dangerous: false, description: "Execute multiple calls in one transaction" },
  "5ae401dc": { signature: "multicall(uint256,bytes[])", dangerous: false, description: "Execute multiple calls with deadline" },

  // Proxy
  "3659cfe6": { signature: "upgradeTo(address)", dangerous: true, description: "Upgrade proxy implementation — VERY DANGEROUS if unauthorized" },
  "4f1ef286": { signature: "upgradeToAndCall(address,bytes)", dangerous: true, description: "Upgrade proxy and call initializer — VERY DANGEROUS" },
};
