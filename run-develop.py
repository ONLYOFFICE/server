#!/usr/bin/env python
# Quick-start script for local development.
# Launches all services assuming dependencies are already installed (npm ci).
# For personal overrides (--inspect, debug env vars, etc.) copy this file
# to run-develop-local.py — it is gitignored.

import sys
sys.path.append('../build_tools/scripts')
import os
import base

def build_modules():
  path = '.'
  base.print_info('Install: ' + path)
  base.cmd_in_dir(path, 'npm', ['ci'])
  base.print_info('Build: server (npm run build)')
  base.cmd('npm', ['run', 'build'])
  if os.path.isdir('../server-admin-panel'):
    base.print_info('Build: server-admin-panel')
    base.cmd_in_dir('../server-admin-panel', 'npm', ['run', 'build'])

def run_module(directory, args=[]):
  base.run_nodejs_in_dir(directory, args)

def run_integration_example():
  base.cmd_in_dir('../document-server-integration/web/documentserver-example/nodejs', 'python', ['run-develop.py'])

try:

  platform = base.host_platform()
  server_root = os.path.dirname(os.path.abspath(__file__))

  run_integration_example()

  # build_modules()

  base.create_dir('App_Data')

  base.set_env('NODE_ENV', 'development-' + platform)
  base.set_env('NODE_CONFIG_DIR', os.path.join(server_root, 'Common', 'config'))
  base.set_env('APPLICATION_NAME', 'onlyoffice')

  if ("mac" == platform):
    base.set_env('DYLD_LIBRARY_PATH', os.path.join(server_root, 'FileConverter', 'bin'))
  elif ("linux" == platform):
    base.set_env('LD_LIBRARY_PATH', os.path.join(server_root, 'FileConverter', 'bin'))

  run_module('DocService', ['sources/server.js'])
  run_module('FileConverter', ['sources/convertermaster.js'])
  if os.path.isdir('../server-admin-panel'):
    base.cmd_in_dir('../server-admin-panel/server', 'npm', ['run', 'start'])

except SystemExit:
  input("Ignoring SystemExit. Press Enter to continue...")
