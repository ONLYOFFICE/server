const fs = require('fs');
const path = require('path');
const glob = require('glob');

const fileToCopy = [
	'./**/sources/*.js',
	'./Common/package.json',
	'./Common/config/*.json',
	'./Common/config/log4js/*.json',
	'./DocService/package.json',
	'./DocService/public/healthcheck.docx',
	'./FileConverter/package.json',
	'./FileConverter/bin/DoctRenderer.config',
	'./Metrics/package.json',
	'./Metrics/config/config.js'
]

const destination = './build/server';

if (!fs.existsSync(destination)) {
	fs.mkdirSync(destination, { recursive: true });
}

const expandedFiles = glob.sync('./**/sources/*.js');
for (const expandedFile of expandedFiles) {
	const directoryPath = path.resolve(destination, path.dirname(expandedFile));
	if (!fs.existsSync(directoryPath)) {
		fs.mkdirSync(directoryPath, { recursive: true });
	}
}

for (const filePattern of fileToCopy) {
	const expandedFiles = glob.sync(filePattern, { nodir: true });
	for (const sourceFilePath of expandedFiles) {
		const relativePath = path.relative('.', sourceFilePath);
		const destinationFilepath = path.resolve(destination, relativePath);
		
		const destinationDirectory = path.dirname(destinationFilepath);
		if (!fs.existsSync(destinationDirectory)) {
			fs.mkdirSync(destinationDirectory, { recursive: true });
		}

		fs.copyFileSync(sourceFilePath, destinationFilepath);
		console.log(`Copied file '${sourceFilePath}' to '${destinationFilepath}'`);
	}
}