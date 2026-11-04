'use strict';
// The ImmuPact verification standard, version 1.
//
// These are the public facts a Vault needs to check a document on its own, without asking
// ImmuPact's servers: which chain, which contracts, and how fingerprints are calculated.
// See docs/SPEC.md ("The ImmuPact standard").

const { keccak256 } = require('ethers');

const STANDARD_VERSION = 1;

const NETWORKS = {
  sepolia: {
    name: 'Ethereum Sepolia (testnet)',
    chainId: 11155111,
    explorer: 'https://sepolia.etherscan.io',
    // Public JSON-RPC endpoints, tried in order. Users can replace them in Settings.
    rpcs: [
      'https://ethereum-sepolia-rpc.publicnode.com',
      'https://sepolia.drpc.org',
      'https://1rpc.io/sepolia',
    ],
    // ImmuPact core contracts. v1 records the wording only; v2 also records the final PDF.
    coreV1: '0x79ff132E2F27370B678a710eFC232724dBdB30CD',
    coreV2: '0x6B28f8508682dCF33B5049371BE21Ea49D507412',
  },
};

const DEFAULT_NETWORK = 'sepolia';

// Only the read-only functions the Vault calls.
const V1_ABI = [
  'function verifyHash(string contractId, bytes32 hashToVerify) view returns (bool)',
  'function getContract(string contractId) view returns (bytes32 contentHash, string title, address creator, uint8 required, uint8 signed, bool isActive, bool isDisputed, bool isExecuted, uint256 createdAt, uint256 lastActivityAt)',
];
const V2_ABI = [
  'function verifyDocument(bytes32 agreementId, bytes32 hash) view returns (uint8 kind, uint32 version, bool inForce, uint8 status)',
  'function getAgreement(bytes32 agreementId) view returns ((address creator, address arbitrator, bytes32 contentHash, uint64 createdAt, uint64 lastActivityAt, uint32 version, uint32 activeVersion, uint32 inactivityDays, uint16 signedCount, uint8 minIdentityLevel, uint8 status) a, uint256 partyCount)',
];

// verifyDocument "kind": what the hash matched.
const V2_KIND = ['none', 'content', 'final_document'];
const V2_STATUS = ['none', 'pending', 'active', 'rejected', 'disputed', 'terminated', 'emergency_released'];

/** The file fingerprint: keccak256 of the exact bytes. The anchored final PDF has this on-chain. */
function fileFingerprint(bytes) {
  return keccak256(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
}

module.exports = { STANDARD_VERSION, NETWORKS, DEFAULT_NETWORK, V1_ABI, V2_ABI, V2_KIND, V2_STATUS, fileFingerprint };
