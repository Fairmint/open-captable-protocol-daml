#!/usr/bin/env node

import { LedgerJsonApiClient } from '@fairmint/canton-node-sdk';
import * as path from 'path';

async function main() {
  console.log('Uploading DAR file...');
  
  const client = new LedgerJsonApiClient();
  await client.uploadDarFile({ filePath: path.join(__dirname, '..', 'OpenCapTable-v02', '.daml', 'dist', 'OpenCapTable-v02-0.0.1.dar') });

  console.log('✅ DAR file uploaded successfully');
}

main(); 