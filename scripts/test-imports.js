#!/usr/bin/env node

// Test importing from the package root
console.log('Testing imports from @fairmint/open-captable-protocol-daml-js...');

try {
    // This would be the actual import when the package is published
    // For now, we'll test the local structure
    const path = require('path');
    const packagePath = path.join(__dirname, '..', 'generated', 'js', 'OpenCapTable-v02-0.0.1');
    
    // Test the main entry point
    const main = require(path.join(packagePath, 'index.js'));
    
    console.log('✅ Main import successful');
    console.log('Available exports:', Object.keys(main));
    
    // Test the lib import (backward compatibility)
    if (main.lib) {
        console.log('✅ Lib import successful');
        console.log('Lib exports:', Object.keys(main.lib));
    }
    
    // Test specific module imports
    if (main.Fairmint) {
        console.log('✅ Fairmint import successful');
        console.log('Fairmint exports:', Object.keys(main.Fairmint));
        
        if (main.Fairmint.OpenCapTable) {
            console.log('✅ OpenCapTable import successful');
            console.log('OpenCapTable exports:', Object.keys(main.Fairmint.OpenCapTable));
        }
    }
    
    console.log('✅ All import tests passed!');
    console.log('\nUsage examples:');
    console.log('import { Fairmint } from "@fairmint/open-captable-protocol-daml-js";');
    console.log('import { lib } from "@fairmint/open-captable-protocol-daml-js";');
    console.log('const { Fairmint } = require("@fairmint/open-captable-protocol-daml-js");');
    
} catch (error) {
    console.error('❌ Import test failed:', error.message);
    process.exit(1);
} 