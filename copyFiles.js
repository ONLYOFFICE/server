const fs = require('fs');
const { execSync } = require('child_process');

const copyFiles = (source, destination) => {
  try {
    execSync(`npx copyfiles ${source} ${destination}`);
    console.log(`Copied files from ${source} to ${destination}`);
  } catch (error) {
    console.error(`Error copying files from ${source} to ${destination}:`, error);
    process.exit(1);
  }
};

const destination = './build/server';

const copyDirectories = () => {
  const commands = [
    {
      source: './Common/package.json ./Common/config/*.json ./Common/config/log4js/*.json',
      destination: destination
    },
    {
      source: './DocService/package.json ./DocService/public/healthcheck.docx',
      destination: destination
    },
    {
      source: './FileConverter/package.json ./FileConverter/bin/DoctRenderer.config',
      destination: destination
    },
    {
      source: './Metrics/package.json ./Metrics/config/config.js',
      destination: destination
    },
    {
      source: './**/sources/*.js',
      destination: destination
    }
  ];

  for (const command of commands) {
    copyFiles(command.source, command.destination);
  }
};

copyDirectories();