import path from 'path';

try {
	const pkg = require(path.join('..', 'generated', 'js', 'OpenCapTable-v03-0.0.1'));
	if (!pkg || !pkg.Fairmint || !pkg.DA) {
		throw new Error('Entry exports missing expected namespaces');
	}
	console.log('OK: Generated package entry loads with Fairmint and DA');
} catch (e: any) {
	console.error('Import test failed:', e?.message || e);
	process.exit(1);
} 