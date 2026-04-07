/**
 * Core analysis engine for smart contract security scanning.
 *
 * Performs source-level regex matching and bytecode pattern analysis.
 * Designed for speed — no AST parsing, no heavy dependencies.
 */

import { ethers } from "ethers";
import {
  VULN_PATTERNS,
  DANGEROUS_SELECTORS,
  COMMON_SELECTORS,
  type Finding,
  type Severity,
} from "./patterns.js";
import { type ChainInfo, getExplorerApiKey } from "./provider.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ContractMetadata {
  address: string;
  name: string;
  compilerVersion: string;
  optimization: boolean;
  isProxy: boolean;
  isVerified: boolean;
  bytecodeSize: number;
}

export interface OwnerAnalysis {
  ownerAddress: string;
  ownerIsZero: boolean;
  ownerIsContract: boolean;
  privileges: string[];
}

export interface SecurityReport {
  riskScore: number;
  riskLevel: "SAFE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  findings: Finding[];
  metadata: ContractMetadata;
  owner: OwnerAnalysis;
  detectedFunctions: Array<{ selector: string; name: string; risk: string }>;
  explorerUrl: string;
  suggestion: string;
  related_tools: string[];
}

export interface QuickCheckResult {
  address: string;
  isContract: boolean;
  isVerified: boolean;
  verificationChecked: boolean;
  bytecodeSize: number;
  hasSelfDestruct: boolean;
  hasProxy: boolean;
  hasMint: boolean;
  hasPause: boolean;
  hasBlacklist: boolean;
  ownerAddress: string;
  riskFlags: string[];
  explorerUrl: string;
  suggestion: string;
  related_tools: string[];
}

export interface CompareResult {
  address1: string;
  address2: string;
  sameBytecode: boolean;
  bytecodeSize1: number;
  bytecodeSize2: number;
  report1: SecurityReport;
  report2: SecurityReport;
  comparison: {
    riskScoreDiff: number;
    saferContract: string;
    sharedFindings: string[];
    uniqueToFirst: string[];
    uniqueToSecond: string[];
    accessControlDifferences: string[];
  };
  suggestion: string;
  related_tools: string[];
}

export interface CalldataDecodeResult {
  selector: string;
  functionSignature: string;
  functionName: string;
  parameters: Array<{ name: string; type: string; value: string }>;
  humanReadable: string;
  isDangerous: boolean;
  dangerReason?: string;
  suggestion: string;
  related_tools: string[];
}

// ── Explorer API helpers ─────────────────────────────────────────────────────

interface EtherscanSourceResult {
  SourceCode: string;
  ContractName: string;
  CompilerVersion: string;
  OptimizationUsed: string;
  ABI: string;
}

/**
 * Fetch verified source code from Etherscan-compatible API.
 */
export async function fetchContractSource(
  address: string,
  chain: ChainInfo,
): Promise<{ source: string; metadata: Partial<ContractMetadata>; abi: string } | null> {
  const apiKey = getExplorerApiKey(chain);
  if (!apiKey) return null;

  try {
    if (!ethers.isAddress(address)) {
      throw new Error("Invalid address format");
    }
    const params = new URLSearchParams({
      module: "contract",
      action: "getsourcecode",
      address,
      apikey: apiKey || "",
    });
    const url = `${chain.explorerApiUrl}?${params.toString()}`;
    const res = await fetch(url);
    const data = (await res.json()) as { status: string; result: EtherscanSourceResult[] };

    if (data.status !== "1" || !data.result?.length) return null;

    const contract = data.result[0];
    if (!contract.SourceCode || contract.SourceCode === "") return null;

    let sourceCode = contract.SourceCode;
    if (sourceCode.startsWith("{{")) {
      try {
        const parsed = JSON.parse(sourceCode.slice(1, -1));
        const sources = parsed.sources as Record<string, { content: string }>;
        sourceCode = Object.values(sources).map((s) => s.content).join("\n\n");
      } catch {
        process.stderr.write("[scanner] Failed to parse multi-source Etherscan format\n");
      }
    } else if (sourceCode.startsWith("{")) {
      try {
        const parsed = JSON.parse(sourceCode) as Record<string, { content: string }>;
        sourceCode = Object.values(parsed).map((s) => s.content).join("\n\n");
      } catch {
        process.stderr.write("[scanner] Failed to parse JSON source format\n");
      }
    }

    return {
      source: sourceCode,
      metadata: {
        name: contract.ContractName || "Unknown",
        compilerVersion: contract.CompilerVersion || "Unknown",
        optimization: contract.OptimizationUsed === "1",
        isVerified: true,
      },
      abi: contract.ABI,
    };
  } catch {
    return null;
  }
}

// ── Source Code Analysis ─────────────────────────────────────────────────────

export function analyzeSource(source: string): Finding[] {
  const findings: Finding[] = [];
  const lines = source.split("\n");

  for (const pattern of VULN_PATTERNS) {
    if (!pattern.sourceRegex) continue;

    let matched = false;
    for (let i = 0; i < lines.length; i++) {
      const chunk = lines.slice(i, Math.min(i + 10, lines.length)).join("\n");
      if (pattern.sourceRegex.test(chunk)) {
        findings.push({
          patternId: pattern.id,
          name: pattern.name,
          severity: pattern.severity,
          category: pattern.category,
          description: pattern.description,
          recommendation: pattern.recommendation,
          lineNumber: i + 1,
          matchedText: lines[i].trim().substring(0, 120),
        });
        matched = true;
        break;
      }
    }

    if (!matched && pattern.sourceRegex.test(source)) {
      findings.push({
        patternId: pattern.id,
        name: pattern.name,
        severity: pattern.severity,
        category: pattern.category,
        description: pattern.description,
        recommendation: pattern.recommendation,
      });
    }
  }

  return findings;
}

// ── Bytecode Analysis ────────────────────────────────────────────────────────

export function analyzeBytecode(bytecode: string): {
  findings: Finding[];
  detectedFunctions: Array<{ selector: string; name: string; risk: string }>;
} {
  const findings: Finding[] = [];
  const detectedFunctions: Array<{ selector: string; name: string; risk: string }> = [];
  const codeHex = bytecode.toLowerCase().replace("0x", "");

  for (const [selector, info] of Object.entries(DANGEROUS_SELECTORS)) {
    if (codeHex.includes(selector)) {
      detectedFunctions.push({ selector: `0x${selector}`, name: info.name, risk: info.risk });
    }
  }

  for (const pattern of VULN_PATTERNS) {
    if (!pattern.bytecodeSignature) continue;
    if (codeHex.includes(pattern.bytecodeSignature.toLowerCase())) {
      findings.push({
        patternId: pattern.id + "-bytecode",
        name: pattern.name + " (bytecode)",
        severity: pattern.severity,
        category: pattern.category,
        description: pattern.description,
        recommendation: pattern.recommendation,
      });
    }
  }

  return { findings, detectedFunctions };
}

// ── Risk Scoring ─────────────────────────────────────────────────────────────

const SEVERITY_WEIGHTS: Record<Severity, number> = {
  critical: 25,
  high: 15,
  medium: 8,
  low: 3,
  info: 0,
};

export function calculateRiskScore(findings: Finding[]): {
  score: number;
  level: "SAFE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
} {
  const seen = new Set<string>();
  let score = 0;

  for (const f of findings) {
    const baseId = f.patternId.replace("-bytecode", "");
    if (seen.has(baseId)) continue;
    seen.add(baseId);
    score += SEVERITY_WEIGHTS[f.severity];
  }

  score = Math.min(100, score);

  let level: "SAFE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  if (score === 0) level = "SAFE";
  else if (score <= 15) level = "LOW";
  else if (score <= 40) level = "MEDIUM";
  else if (score <= 70) level = "HIGH";
  else level = "CRITICAL";

  return { score, level };
}

// ── Owner Analysis ───────────────────────────────────────────────────────────

export async function analyzeOwner(
  address: string,
  provider: ethers.JsonRpcProvider,
  bytecode: string,
): Promise<OwnerAnalysis> {
  let ownerAddress = "unknown";
  let ownerIsZero = false;
  let ownerIsContract = false;
  const privileges: string[] = [];

  try {
    const iface = new ethers.Interface(["function owner() view returns (address)"]);
    const callData = iface.encodeFunctionData("owner");
    const result = await provider.call({ to: address, data: callData });
    ownerAddress = iface.decodeFunctionResult("owner", result)[0];
    ownerIsZero = ownerAddress === ethers.ZeroAddress;

    if (!ownerIsZero && ownerAddress !== "unknown") {
      const ownerCode = await provider.getCode(ownerAddress);
      ownerIsContract = ownerCode !== "0x";
    }
  } catch {
    ownerAddress = "none (no owner function)";
  }

  const codeHex = bytecode.toLowerCase().replace("0x", "");
  if (codeHex.includes("40c10f19")) privileges.push("Can mint tokens");
  if (codeHex.includes("8456cb59")) privileges.push("Can pause contract");
  if (codeHex.includes("44337ea1")) privileges.push("Can blacklist addresses");
  if (codeHex.includes("e4997dc5")) privileges.push("Can exclude from fees");
  if (codeHex.includes("3659cfe6")) privileges.push("Can upgrade contract implementation");
  if (codeHex.includes("f2fde38b")) privileges.push("Can transfer ownership");
  if (codeHex.includes("3ccfd60b") || codeHex.includes("51cff8d9")) privileges.push("Can withdraw funds");

  if (ownerIsZero) {
    privileges.push("Ownership renounced (owner = 0x0) — privileges are locked");
  }

  return { ownerAddress, ownerIsZero, ownerIsContract, privileges };
}

// ── Full Analysis ────────────────────────────────────────────────────────────

export async function fullAnalysis(
  address: string,
  provider: ethers.JsonRpcProvider,
  chain: ChainInfo,
): Promise<SecurityReport> {
  const explorerUrl = `${chain.explorerUrl}/address/${address}`;

  const bytecode = await provider.getCode(address);
  if (bytecode === "0x") {
    throw new Error(`No contract found at ${address}. This is an EOA (externally owned account), not a smart contract.`);
  }

  const sourceData = await fetchContractSource(address, chain);
  const { findings: bytecodeFindings, detectedFunctions } = analyzeBytecode(bytecode);

  let sourceFindings: Finding[] = [];
  if (sourceData?.source) {
    sourceFindings = analyzeSource(sourceData.source);
  }

  // Merge findings, dedup by base pattern ID
  const mergedFindings: Finding[] = [...sourceFindings];
  const sourcePatternIds = new Set(sourceFindings.map((f) => f.patternId));
  for (const bf of bytecodeFindings) {
    const baseId = bf.patternId.replace("-bytecode", "");
    if (!sourcePatternIds.has(baseId)) {
      mergedFindings.push(bf);
    }
  }

  const owner = await analyzeOwner(address, provider, bytecode);
  const { score, level } = calculateRiskScore(mergedFindings);

  const metadata: ContractMetadata = {
    address,
    name: sourceData?.metadata?.name || "Unknown (not verified)",
    compilerVersion: sourceData?.metadata?.compilerVersion || "Unknown",
    optimization: sourceData?.metadata?.optimization ?? false,
    isProxy: detectedFunctions.some((f) => f.selector === "0x5c60da1b"),
    isVerified: !!sourceData,
    bytecodeSize: (bytecode.length - 2) / 2,
  };

  let suggestion: string;
  if (level === "SAFE") {
    suggestion = "No vulnerabilities detected. Contract appears safe to interact with, but this is a heuristic scan — not a full audit.";
  } else if (level === "LOW") {
    suggestion = "Minor issues found. Contract is likely safe for standard interactions. Review the findings for best-practice improvements.";
  } else if (level === "MEDIUM") {
    suggestion = "Moderate risk detected. Review each finding carefully before interacting. Consider using scanner_check_address to verify the owner address.";
  } else if (level === "HIGH") {
    suggestion = "High risk — multiple concerning patterns found. Proceed with extreme caution. Consider smaller test transactions first.";
  } else {
    suggestion = "CRITICAL risk — do NOT interact with this contract without thorough manual review. Multiple severe vulnerabilities detected.";
  }

  if (!sourceData) {
    suggestion += " Note: Source code is not verified — analysis is based on bytecode only. Request the project to verify their source on the block explorer.";
  }

  const severityOrder: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  mergedFindings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return {
    riskScore: score,
    riskLevel: level,
    findings: mergedFindings,
    metadata,
    owner,
    detectedFunctions,
    explorerUrl,
    suggestion,
    related_tools: ["scanner_check_address", "scanner_compare_contracts", "scanner_decode_calldata"],
  };
}

// ── Quick Check ──────────────────────────────────────────────────────────────

export async function quickCheck(
  address: string,
  provider: ethers.JsonRpcProvider,
  chain: ChainInfo,
): Promise<QuickCheckResult> {
  const explorerUrl = `${chain.explorerUrl}/address/${address}`;

  const bytecode = await provider.getCode(address);
  const isContract = bytecode !== "0x";

  if (!isContract) {
    return {
      address,
      isContract: false,
      isVerified: false,
      verificationChecked: false,
      bytecodeSize: 0,
      hasSelfDestruct: false,
      hasProxy: false,
      hasMint: false,
      hasPause: false,
      hasBlacklist: false,
      ownerAddress: "N/A (EOA)",
      riskFlags: ["This is an EOA (externally owned account), not a contract"],
      explorerUrl,
      suggestion: "This address is not a smart contract. If you expected a contract, double-check the address and chain.",
      related_tools: ["scanner_analyze_contract"],
    };
  }

  const codeHex = bytecode.toLowerCase().replace("0x", "");
  // SELFDESTRUCT is opcode 0xFF. Naive codeHex.includes("ff") matches ANY byte containing ff
  // (addresses, constants, etc.) causing massive false positives. Instead, look for the
  // SELFDESTRUCT function selector pattern: selfdestruct is typically preceded by PUSH20 (0x73)
  // for the recipient address. We also check for the known selfdestruct selector.
  const hasSelfDestruct = codeHex.includes("73") && (
    // Pattern: PUSH20 <20-byte-addr> FF (common selfdestruct pattern)
    /73[0-9a-f]{40}ff/.test(codeHex) ||
    // Known selfdestruct wrapper function selectors
    codeHex.includes("cb4e18a4") || // selfdestruct() custom
    codeHex.includes("00f55d9d")    // destroy(address)
  );
  const hasProxy = codeHex.includes("5c60da1b") || codeHex.includes("360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc");
  const hasMint = codeHex.includes("40c10f19");
  const hasPause = codeHex.includes("8456cb59");
  const hasBlacklist = codeHex.includes("44337ea1");

  let ownerAddress = "unknown";
  try {
    const iface = new ethers.Interface(["function owner() view returns (address)"]);
    const callData = iface.encodeFunctionData("owner");
    const result = await provider.call({ to: address, data: callData });
    ownerAddress = iface.decodeFunctionResult("owner", result)[0];
  } catch {
    ownerAddress = "none";
  }

  let isVerified: boolean | null = null; // null = couldn't check
  const apiKey = getExplorerApiKey(chain);
  if (apiKey) {
    const sourceData = await fetchContractSource(address, chain);
    isVerified = !!sourceData;
  }

  const riskFlags: string[] = [];
  if (hasSelfDestruct) riskFlags.push("SELFDESTRUCT opcode detected");
  if (hasProxy) riskFlags.push("Proxy pattern — upgradeable contract");
  if (hasMint) riskFlags.push("Mint function detected");
  if (hasPause) riskFlags.push("Pause function detected");
  if (hasBlacklist) riskFlags.push("Blacklist function detected");
  if (isVerified === false) riskFlags.push("Source code NOT verified on block explorer");
  if (isVerified === null) riskFlags.push("Source verification could not be checked (no explorer API key configured)");
  if (ownerAddress !== ethers.ZeroAddress && ownerAddress !== "none") {
    riskFlags.push(`Active owner: ${ownerAddress}`);
  }
  if (ownerAddress === ethers.ZeroAddress) {
    riskFlags.push("Ownership renounced (good)");
  }
  if (riskFlags.length === 0) {
    riskFlags.push("No immediate risk flags detected");
  }

  const highRiskCount = [hasSelfDestruct, hasMint, hasPause, hasBlacklist, hasProxy].filter(Boolean).length;
  let suggestion: string;
  if (highRiskCount === 0 && isVerified) {
    suggestion = "Quick check looks clean. For a full vulnerability analysis, use scanner_analyze_contract.";
  } else if (highRiskCount <= 1) {
    suggestion = "Minor risk indicators found. Run scanner_analyze_contract for detailed vulnerability report.";
  } else {
    suggestion = `Multiple risk indicators (${highRiskCount}) found. Strongly recommend running scanner_analyze_contract before interacting.`;
  }

  return {
    address,
    isContract,
    isVerified: isVerified ?? false,
    verificationChecked: isVerified !== null,
    bytecodeSize: (bytecode.length - 2) / 2,
    hasSelfDestruct,
    hasProxy,
    hasMint,
    hasPause,
    hasBlacklist,
    ownerAddress,
    riskFlags,
    explorerUrl,
    suggestion,
    related_tools: ["scanner_analyze_contract", "scanner_compare_contracts"],
  };
}

// ── Compare Contracts ────────────────────────────────────────────────────────

export async function compareContracts(
  address1: string,
  address2: string,
  provider: ethers.JsonRpcProvider,
  chain: ChainInfo,
): Promise<CompareResult> {
  const [report1, report2, bytecode1, bytecode2] = await Promise.all([
    fullAnalysis(address1, provider, chain),
    fullAnalysis(address2, provider, chain),
    provider.getCode(address1),
    provider.getCode(address2),
  ]);

  const sameBytecode = bytecode1 === bytecode2;

  const findings1Set = new Set(report1.findings.map((f) => f.patternId.replace("-bytecode", "")));
  const findings2Set = new Set(report2.findings.map((f) => f.patternId.replace("-bytecode", "")));

  const sharedFindings: string[] = [];
  const uniqueToFirst: string[] = [];
  const uniqueToSecond: string[] = [];

  for (const id of findings1Set) {
    const finding = report1.findings.find((f) => f.patternId.replace("-bytecode", "") === id);
    if (findings2Set.has(id)) {
      if (finding) sharedFindings.push(`${finding.name} (${finding.severity})`);
    } else {
      if (finding) uniqueToFirst.push(`${finding.name} (${finding.severity})`);
    }
  }
  for (const id of findings2Set) {
    if (!findings1Set.has(id)) {
      const finding = report2.findings.find((f) => f.patternId.replace("-bytecode", "") === id);
      if (finding) uniqueToSecond.push(`${finding.name} (${finding.severity})`);
    }
  }

  const accessControlDifferences: string[] = [];
  const privs1 = new Set(report1.owner.privileges);
  const privs2 = new Set(report2.owner.privileges);
  for (const p of privs1) {
    if (!privs2.has(p)) accessControlDifferences.push(`Only contract 1: ${p}`);
  }
  for (const p of privs2) {
    if (!privs1.has(p)) accessControlDifferences.push(`Only contract 2: ${p}`);
  }
  if (report1.owner.ownerIsZero !== report2.owner.ownerIsZero) {
    accessControlDifferences.push(
      report1.owner.ownerIsZero
        ? "Contract 1 has renounced ownership, contract 2 has not"
        : "Contract 2 has renounced ownership, contract 1 has not",
    );
  }

  const saferContract =
    report1.riskScore < report2.riskScore ? address1 :
    report2.riskScore < report1.riskScore ? address2 :
    "Both have equal risk scores";

  const riskScoreDiff = Math.abs(report1.riskScore - report2.riskScore);

  let suggestion: string;
  if (sameBytecode) {
    suggestion = "These contracts have identical bytecode — they are clones. Risk profile is the same. Check if the owner addresses differ.";
  } else if (riskScoreDiff === 0) {
    suggestion = "Both contracts have the same risk score. Review individual findings to determine which is safer for your use case.";
  } else {
    suggestion = `Contract ${saferContract} is safer (risk score ${Math.min(report1.riskScore, report2.riskScore)} vs ${Math.max(report1.riskScore, report2.riskScore)}). Review the unique findings for each contract.`;
  }

  return {
    address1,
    address2,
    sameBytecode,
    bytecodeSize1: report1.metadata.bytecodeSize,
    bytecodeSize2: report2.metadata.bytecodeSize,
    report1,
    report2,
    comparison: {
      riskScoreDiff,
      saferContract,
      sharedFindings,
      uniqueToFirst,
      uniqueToSecond,
      accessControlDifferences,
    },
    suggestion,
    related_tools: ["scanner_analyze_contract", "scanner_check_address"],
  };
}

// ── Calldata Decoder ─────────────────────────────────────────────────────────

export function decodeCalldata(
  calldata: string,
  abiJson?: string,
): CalldataDecodeResult {
  const data = calldata.startsWith("0x") ? calldata : "0x" + calldata;

  if (data.length < 10) {
    throw new Error("Calldata too short — must be at least 4 bytes (8 hex chars + 0x prefix). This might be a plain ETH transfer (no calldata).");
  }

  const selector = data.slice(0, 10).toLowerCase();
  const selectorHex = selector.slice(2);

  // Try ABI decode first
  if (abiJson) {
    try {
      if (abiJson.length > 50_000) {
        throw new Error("ABI JSON too large (max 50KB)");
      }
      const parsedAbi = JSON.parse(abiJson);
      if (!Array.isArray(parsedAbi)) {
        throw new Error("ABI must be a JSON array");
      }
      const iface = new ethers.Interface(parsedAbi);
      const parsed = iface.parseTransaction({ data });
      if (parsed) {
        const params = parsed.fragment.inputs.map((input, i) => ({
          name: input.name || `param${i}`,
          type: input.type,
          value: formatParamValue(parsed.args[i]),
        }));

        const knownSelector = COMMON_SELECTORS[selectorHex];
        const isDangerous = knownSelector?.dangerous ?? false;

        return {
          selector,
          functionSignature: parsed.fragment.format("full"),
          functionName: parsed.fragment.name,
          parameters: params,
          humanReadable: `${parsed.fragment.name}(${params.map((p) => `${p.name}=${p.value}`).join(", ")})`,
          isDangerous,
          dangerReason: isDangerous ? knownSelector?.description : undefined,
          suggestion: isDangerous
            ? `This is a potentially dangerous operation: ${knownSelector?.description}. Review parameters carefully before signing.`
            : "Function decoded successfully. Parameters look standard.",
          related_tools: ["scanner_analyze_contract", "scanner_check_address"],
        };
      }
    } catch {
      // Fall through to selector lookup
    }
  }

  // Try common selector lookup
  const knownSelector = COMMON_SELECTORS[selectorHex];
  if (knownSelector) {
    let params: Array<{ name: string; type: string; value: string }> = [];
    try {
      const iface = new ethers.Interface([`function ${knownSelector.signature}`]);
      const parsed = iface.parseTransaction({ data });
      if (parsed) {
        params = parsed.fragment.inputs.map((input, i) => ({
          name: input.name || `param${i}`,
          type: input.type,
          value: formatParamValue(parsed.args[i]),
        }));
      }
    } catch {
      // Can't decode params
    }

    const funcName = knownSelector.signature.split("(")[0];

    return {
      selector,
      functionSignature: knownSelector.signature,
      functionName: funcName,
      parameters: params,
      humanReadable: params.length > 0
        ? `${funcName}(${params.map((p) => `${p.name}=${p.value}`).join(", ")})`
        : `${funcName}(...)`,
      isDangerous: knownSelector.dangerous,
      dangerReason: knownSelector.dangerous ? knownSelector.description : undefined,
      suggestion: knownSelector.dangerous
        ? `WARNING: ${knownSelector.description}. Review all parameters before signing this transaction.`
        : `Standard operation: ${knownSelector.description}.`,
      related_tools: ["scanner_analyze_contract", "scanner_check_address"],
    };
  }

  // Unknown selector
  return {
    selector,
    functionSignature: "Unknown",
    functionName: "Unknown",
    parameters: [],
    humanReadable: `Unknown function (selector: ${selector})`,
    isDangerous: true,
    dangerReason: "Unknown function selector — cannot verify safety. The function could do anything.",
    suggestion: "Could not decode this calldata. The function selector is not in our database. Use scanner_analyze_contract on the target contract to understand what this function does, or provide the contract ABI.",
    related_tools: ["scanner_analyze_contract", "scanner_check_address"],
  };
}

function formatParamValue(value: unknown): string {
  if (typeof value === "bigint") {
    if (value > 10n ** 15n) {
      return `${value.toString()} (${ethers.formatEther(value)} ETH-scale)`;
    }
    return value.toString();
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => formatParamValue(v)).join(", ")}]`;
  }
  return String(value);
}
