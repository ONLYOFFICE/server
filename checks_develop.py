import sys
import subprocess
import os 

def check_nodejs_version():
  nodejs_version = run_command('node -v')['stdout']
  if (nodejs_version == ''):
    return ""
   
  nodejs_cur_version = int(nodejs_version.split('.')[0][1:])
  return nodejs_cur_version
  
def check_java_bitness():
  java_version = run_command('java -version')['stderr']
  
  if (java_version.find('64-Bit') == -1):
    return 'x32'
  elif (java_version.find('32-Bit') == -1):
    return 'x64'
  else:
    return ''
    
def check_rabbitmq():
  return run_command('sc query RabbitMQ')['stdout']

def get_erlangPath():
  if (sys.version_info[0] >= 3):
    import winreg
  else:
    import _winreg as winreg
    
  Path = ""
  try:
    keyValue = r"SOFTWARE\WOW6432Node\Ericsson\Erlang"
    aKey = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, keyValue)
    count_subkey = winreg.QueryInfoKey(aKey)[0]
    
    for i in range(count_subkey):
      asubkey_name = winreg.EnumKey(aKey, i)
      if (asubkey_name.split(".")[0].isdigit()):
        asubkey = winreg.OpenKey(aKey, asubkey_name)
        Path = winreg.QueryValueEx(asubkey, None)[0]
      else:
        continue
    return Path
  except:
    return Path
    
def get_mysqlServersPaths():
  if (sys.version_info[0] >= 3):
    import winreg
  else:
    import _winreg as winreg
    
  paths = []
  Path = ""
  
  try:
    keyValue = r"SOFTWARE\WOW6432Node\MySQL AB"
    aKey = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, keyValue)
    count_subkey = winreg.QueryInfoKey(aKey)[0]
    
    for i in range(count_subkey):
      asubkey_name = winreg.EnumKey(aKey, i)
      if (asubkey_name.find('MySQL Server') != - 1):
        asubkey = winreg.OpenKey(aKey, asubkey_name)
        Path = winreg.QueryValueEx(asubkey, 'Location')[0]
        paths.append(Path)
      else:
        continue
    return paths
  except:
    return paths
    
def get_mysqlServersDataPaths():
  if (sys.version_info[0] >= 3):
    import winreg
  else:
    import _winreg as winreg
  
  paths = []
  Path = ""
  
  try:
    keyValue = r"SOFTWARE\WOW6432Node\MySQL AB"
    aKey = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, keyValue)
    count_subkey = winreg.QueryInfoKey(aKey)[0]
    
    for i in range(count_subkey):
      asubkey_name = winreg.EnumKey(aKey, i)
      if (asubkey_name.find('MySQL Server') != - 1):
        asubkey = winreg.OpenKey(aKey, asubkey_name)
        Path = winreg.QueryValueEx(asubkey, 'DataLocation')[0]
        paths.append(Path)
      else:
        continue
    return paths
  except:
    return paths
    
def get_mysqlServersVersions():
  if (sys.version_info[0] >= 3):
    import winreg
  else:
    import _winreg as winreg
  
  Versions = []
  Version = ""
  
  try:
    keyValue = r"SOFTWARE\WOW6432Node\MySQL AB"
    aKey = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, keyValue)
    count_subkey = winreg.QueryInfoKey(aKey)[0]
    
    for i in range(count_subkey):
      asubkey_name = winreg.EnumKey(aKey, i)
      if (asubkey_name.find('MySQL Server') != - 1):
        asubkey = winreg.OpenKey(aKey, asubkey_name)
        Version = winreg.QueryValueEx(asubkey, 'Version')[0]
        Versions.append(Version)
      else:
        continue
    return Versions
  except:
    return Versions
    
def check_erlang():
  erlangPath = get_erlangPath()
  
  if (erlangPath == ""):
    return None
  else:
    return run_command('cd ' + erlangPath + '/bin && erl -eval "erlang:display(erlang:system_info(wordsize)), halt()."  -noshell')['stdout']
  
def check_gruntcli():
  result = run_command('npm list -g --depth=0')['stdout']
  
  if (result.find('grunt-cli') == -1):
    return False
  else:
    return True
    
def check_mysqlServersBitness(MySQLPaths):
  serversBitness = []
  
  for i in range(len(MySQLPaths)):
    mysqlServerPath = MySQLPaths[i]
    result = ""
    if (mysqlServerPath == ""):
      serversBitness.append("")
    else:
      result = run_command('cd ' + mysqlServerPath + 'bin && mysql --version')['stdout']
      if (result.find('for Win32') != -1):
        serversBitness.append('x32')
      elif (result.find('for Win64') != -1):
        serversBitness.append('x64')
      else:
        serversBitness.append('')
  return serversBitness
  
def check_buildTools():
  return True
  
def run_command(sCommand):
  popen = subprocess.Popen(sCommand, stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True) 
  result = {'stdout' : '', 'stderr' : ''}
  try:
    stdout, stderr = popen.communicate()
    popen.wait()
    result['stdout'] = stdout.strip().decode("utf-8") 
    result['stderr'] = stderr.strip().decode("utf-8")
  finally:
    popen.stdout.close()
    popen.stderr.close()
  
  return result

