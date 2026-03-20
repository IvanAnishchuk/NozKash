
# 👻 Ghost-Tip Protocol: Local Testing Guide

This guide explains how to set up your local development environment and run the cryptographic parity tests to ensure the Python Mint and the TypeScript Client produce identical, mathematically sound BLS blind signatures and EVM proofs.

## Prerequisites
* **Python 3.10+**
* **Node.js 20+**
* [uv](https://docs.astral.sh/uv/) (Extremely fast Python package installer and resolver)

---

## 🐍 1. Python Environment Setup (Mint Server)

We use `uv` to manage the Python virtual environment and dependencies blazingly fast.

**1. Create and activate a virtual environment:**
```bash
# Create the virtual environment
uv venv

# Activate it (macOS/Linux)
source .venv/bin/activate

# Activate it (Windows)
.venv\Scripts\activate
```

**2. Install the required cryptographic libraries:**
```bash
uv pip install eth-keys eth-utils py_ecc
```

---

## 🌐 2. TypeScript Environment Setup (Client dApp)

The frontend client relies on WebAssembly (`mcl-wasm`) and modern ESM cryptography modules.

**1. Initialize the project (if you haven't already):**
```bash
npm init -y
```

**2. Install the dependencies:**
```bash
npm install mcl-wasm ethereum-cryptography @noble/curves
```

*(Note: We do not need to install `ts-node` globally, as we will use `tsx` via `npx` to natively handle modern ESM module resolution).*

---

## 🚀 3. Running the Tests

These scripts run the full protocol lifecycle: deriving the deterministic keys, blinding the token, generating the Mint's signature, unblinding, and verifying the final BLS pairings. 

### Run the Python Test
Ensure your virtual environment is active, then execute:
```bash
python ghost_tip_test.py
```
**Expected Output:** You should see a successful transaction log ending with `✅ BLS Pairing Verified! Mathematical proof is flawless.`

### Run the TypeScript Test
Execute the TypeScript file using `tsx` (which automatically handles the `.js` extension imports and modern ESM resolution):
```bash
npx tsx test.ts
```
**Expected Output:** You should see the exact same keys, blinding factors, and points as the Python script, ending with `✅ BLS Pairing Verified! Math matches Python perfectly.`
