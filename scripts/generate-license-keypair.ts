#!/usr/bin/env bun
import { generateLicenseSigningKeyPair } from "@aop/license";

process.stdout.write(`${JSON.stringify(generateLicenseSigningKeyPair(), null, 2)}\n`);
