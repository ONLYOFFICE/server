import sys
sys.path.append('../build_tools/scripts')
import base
import subprocess
import os

if (sys.version_info[0] >= 3):
  import winreg
else:
  import _winreg as winreg
    
class CDependencies:
  def __init__(self):
    self.progsToInstall = []
    self.progsToUninstall = []
    self.pathsToRemove = []
    self.pathToValidMySQLServer = ''
  
  def append(self, oCdependencies):
    self.progsToInstall   += oCdependencies.progsToInstall
    self.progsToUninstall += oCdependencies.progsToUninstall
    self.pathsToRemove    += oCdependencies.pathsToRemove
    self.pathToValidMySQLServer = oCdependencies.pathToValidMySQLServer

def check_nodejs():
  dependence = CDependencies()
  
  base.print_info('Check installed Node.js')
  nodejs_version = base.run_command('node -v')['stdout']
  if (nodejs_version == ''):
    print('Node.js not found')
    dependence.progsToInstall.append('Node.js')
    return dependence
  
  nodejs_cur_version = int(nodejs_version.split('.')[0][1:])
  print('Installed Node.js version: ' + str(nodejs_cur_version))
  nodejs_min_version = 8
  nodejs_max_version = 10
  if (nodejs_min_version > nodejs_cur_version or nodejs_cur_version > nodejs_max_version):
    print('Installed Node.js version must be 8.x to 10.x')
    dependence.progsToUninstall.append('Node.js')
    dependence.progsToInstall.append('Node.js')
    return dependence
  
  print('Installed Node.js is valid')
  return dependence
  
def check_java():
  dependence = CDependencies()
  
  base.print_info('Check installed Java')
  java_version = base.run_command('java -version')['stderr']
  
  if (java_version.find('64-Bit') != -1):
    print('Installed Java is valid')
    return dependence
  
  if (java_version.find('32-Bit') != -1):
    print('Installed Java must be x64')
  else:
    print('Java not found')
  
  dependence.progsToInstall.append('Java')
  return dependence
    
def check_rabbitmq():
  dependence = CDependencies()
  base.print_info('Check installed RabbitMQ')
  result = base.run_command('sc query RabbitMQ')['stdout']
  
  if (result.find('RabbitMQ') != -1):
    print('Installed RabbitMQ is valid')
    return dependence
  
  print('RabbitMQ not found')
  dependence.progsToUninstall.append('RabbitMQ')
  dependence.progsToUninstall.append('Erlang')
  dependence.progsToInstall.append('Erlang')
  dependence.progsToInstall.append('RabbitMQ')
  return dependence
  
def check_erlang():
  dependence = CDependencies()
  base.print_info('Check installed Erlang')
  erlangHome = os.getenv("ERLANG_HOME")
  
  if (erlangHome != ""):
    erlangBitness = base.run_command('"' + erlangHome + '\\bin\\erl" -eval "erlang:display(erlang:system_info(wordsize)), halt()." -noshell')['stdout']
    if (erlangBitness == '8'):
      print("Installed Erlang is valid")
      return dependence
  
  print('Need Erlang with bitness x64')
  dependence.progsToUninstall.append('Erlang')
  dependence.progsToUninstall.append('RabbitMQ')
  dependence.progsToInstall.append('Erlang')
  dependence.progsToInstall.append('RabbitMQ')
  return dependence

def check_gruntcli():
  dependence = CDependencies()
  
  base.print_info('Check installed Grunt-Cli')
  result = base.run_command('npm list -g --depth=0')['stdout']
  
  if (result.find('grunt-cli') == -1):
    print('Grunt-Cli not found')
    dependence.progsToInstall.append('GruntCli')
    return dependence
  
  print('Installed Grunt-Cli is valid')
  return dependence
    
def get_mysqlServersInfo(sParam):
  arrInfo = []
  aReg = winreg.ConnectRegistry(None, winreg.HKEY_LOCAL_MACHINE)
  aKey= winreg.OpenKey(aReg, "SOFTWARE\\", 0, winreg.KEY_READ | winreg.KEY_WOW64_32KEY)
  
  try:
    asubkey = winreg.OpenKey(aKey, 'MySQL AB')
    count_subkey = winreg.QueryInfoKey(asubkey)[0]
    
    for i in range(count_subkey):
      MySQLsubkey_name = winreg.EnumKey(asubkey, i)
      if (MySQLsubkey_name.find('MySQL Server') != - 1):
        MySQLsubkey = winreg.OpenKey(asubkey, MySQLsubkey_name)
        arrInfo.append(winreg.QueryValueEx(MySQLsubkey, sParam)[0])
  except:
    pass
      
  return arrInfo 

def check_mysqlInstaller():
  dependence = CDependencies()
  aReg = winreg.ConnectRegistry(None, winreg.HKEY_LOCAL_MACHINE)
  aKey= winreg.OpenKey(aReg, "SOFTWARE\\", 0, winreg.KEY_READ | winreg.KEY_WOW64_32KEY)
  
  try:
    asubkey = winreg.OpenKey(aKey, 'MySQL')
    count_subkey = winreg.QueryInfoKey(asubkey)[0]
    
    for i in range(count_subkey):
      MySQLsubkey_name = winreg.EnumKey(asubkey, i)
      if (MySQLsubkey_name.find('MySQL Installer') != - 1):
        return dependence
  except:
    pass
  dependence.progsToInstall.append('MySQLInstaller')
  return dependence

def check_mysqlServersBitness(MySQLPaths):
  serversBitness = []
  
  for i in range(len(MySQLPaths)):
    mysqlServerPath = MySQLPaths[i]
    result = ""
    if (mysqlServerPath == ""):
      serversBitness.append("")
    else:
      result = base.run_command('"' + mysqlServerPath + 'bin\\mysql" --version')['stdout']
      if (result.find('for Win32') != -1):
        serversBitness.append('x32')
      elif (result.find('for Win64') != -1):
        serversBitness.append('x64')
      else:
        serversBitness.append('')
  return serversBitness
  
def check_mysqlServer(serversBitness, serversVersions, serversPaths, dataPaths):
  dependence = CDependencies()
  
  base.print_info('Check MySQL Server')
  for i in range(len(serversBitness)):
    if serversBitness[i] != '':
      break
    if (i == len(serversBitness) - 1): 
      print('MySQL Server not found')
      dependence.progsToInstall.append('MySQLServer')
      return dependence
    
  for i in range(len(serversBitness)):
    result = serversBitness[i]
    if (result == ""):
      continue 
    elif (result == 'x32'):
      print('MySQL Server ' + serversVersions[i][0:3] + ' bitness is x32, is not valid')
      dependence.progsToUninstall.append('MySQL Server ' + serversVersions[i][0:3])
      continue
    elif (result == 'x64'):
      print('MySQL Server bitness is valid')
      connectionResult = base.run_command('"' + serversPaths[i] + 'bin\\mysql" -u root -ponlyoffice -e "SHOW GLOBAL VARIABLES LIKE ' + r"'PORT';" + '"')['stdout']
      if (connectionResult.find('port') != -1 and connectionResult.find('3306') != -1):
        if (base.run_command('"' + serversPaths[i] + 'bin\\mysql" -u root -ponlyoffice -e "SHOW DATABASES;"')['stdout'].find('onlyoffice') == -1):
          print('Database onlyoffice not found')
          dependence.progsToInstall.append('MySQLDatabase')
        if (base.run_command('"' + serversPaths[i] + 'bin\\mysql" -u root -ponlyoffice -e "SELECT plugin from mysql.user where User=' + "'root';")['stdout'].find('mysql_native_password') == -1):
          print('Password encryption is not valid')
          dependence.progsToInstall.append('MySQLEncrypt') 
        dependence.pathToValidMySQLServer = serversPaths[i]
        return dependence
      else:
        print('MySQL Server configuration is not valid')
        dependence.progsToUninstall.append('MySQL Server ' + serversVersions[i][0:3])
        dependence.pathsToRemove.append(serversPaths[i])
        dependence.progsToInstall.append('MySQLServer')
        continue
  return dependence
  
def check_buildTools():
  dependence = CDependencies()
  
  base.print_info('Check installed Build Tools')
  result = base.run_command(os.path.split(os.getcwd())[0] + '\\build_tools\\tools\\win\\vswhere\\vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property DisplayName')['stdout']
  if (result == ''):
    print('Build Tools not found')
    dependence.progsToInstall.append('BuildTools')
  else:
    print('Installed Build Tools is valid')
  
  return dependence

def get_programDelInfoByFlag(sName, flag):
  info = []
  aReg = winreg.ConnectRegistry(None, winreg.HKEY_LOCAL_MACHINE)
  aKey= winreg.OpenKey(aReg, "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall", 0, winreg.KEY_READ | flag)
  count_subkey = winreg.QueryInfoKey(aKey)[0]

  for i in range(count_subkey):
    try:
      asubkey_name = winreg.EnumKey(aKey, i)
      asubkey = winreg.OpenKey(aKey, asubkey_name)
      progName = winreg.QueryValueEx(asubkey, 'DisplayName')[0]
    
      if (progName.find(sName) != -1):
        info.append(winreg.QueryValueEx(asubkey, 'UninstallString')[0])
      
    except:
      pass
      
  return info 
  
def get_programDelInfo(sName):
  return get_programDelInfoByFlag(sName, winreg.KEY_WOW64_32KEY) + get_programDelInfoByFlag(sName, winreg.KEY_WOW64_64KEY)

def check_dependencies():
  final_dependence = CDependencies()
  
  final_dependence.append(check_nodejs())
  final_dependence.append(check_java())
  final_dependence.append(check_erlang())
  final_dependence.append(check_rabbitmq())
  final_dependence.append(check_gruntcli())
  final_dependence.append(check_buildTools())
  final_dependence.append(check_mysqlInstaller())
  
  mySQLServersPaths     = get_mysqlServersInfo('Location')
  mySQLServersBitness   = check_mysqlServersBitness(mySQLServersPaths)
  mySQLServersVersions  = get_mysqlServersInfo('Version')
  mySQLServersDataPaths = get_mysqlServersInfo('DataLocation')
  
  final_dependence.append(check_mysqlServer(mySQLServersBitness, mySQLServersVersions, mySQLServersPaths, mySQLServersDataPaths))
  
  return final_dependence
  
