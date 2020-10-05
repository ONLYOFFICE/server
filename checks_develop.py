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
    self.pathsToUninstallers = []
    self.namesOfUninstallers = []
    self.paramsForUninstallers = []
    self.pathsToRemove = []
    self.pathToValidMySQLServer = ''
    
  
  def append(self, oCdependencies):
    self.progsToInstall   += oCdependencies.progsToInstall
    self.progsToUninstall += oCdependencies.progsToUninstall
    self.pathsToRemove    += oCdependencies.pathsToRemove
    self.pathToValidMySQLServer = oCdependencies.pathToValidMySQLServer   

def check_pythonPath():
  path = base.get_env('PATH')
  if (path.find(sys.exec_prefix) == -1):
    base.set_env('PATH', sys.exec_prefix + os.pathsep + path)

def check_nodejs():
  dependence = CDependencies()
  
  base.print_info('Check installed Node.js version')
  nodejs_version = run_command('node -v')['stdout']
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
  
  print('Installed Node.js version is valid')
  return dependence
  
def check_java():
  dependence = CDependencies()
  
  base.print_info('Check installed Java')
  java_version = run_command('java -version')['stderr']
  
  if (java_version.find('64-Bit') != -1):
    print('Installed java is valid')
    return dependence
  
  if (java_version.find('32-Bit') != -1):
    print('Installed java must be x64')
  else:
    print('Java not found')
  
  dependence.progsToInstall.append('Java')
  return dependence
    
def check_rabbitmq():
  dependence = CDependencies()
  
  base.print_info('Check installed RabbitMQ')
  result = run_command('sc query RabbitMQ')['stdout']
  if (result.find('RabbitMQ') == -1):
    dependence.progsToInstall.append('RabbitMQ')
    return dependence
  print('Installed RabbitMQ is valid')
  return dependence

def get_erlangPaths():
  Paths = []
  try:
    keyValue = r"SOFTWARE\WOW6432Node\Ericsson\Erlang"
    aKey = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, keyValue)
    count_subkey = winreg.QueryInfoKey(aKey)[0]
    
    for i in range(count_subkey, 0, -1):
      asubkey_name = winreg.EnumKey(aKey, i)
      if (asubkey_name.split(".")[0].isdigit()):
        asubkey = winreg.OpenKey(aKey, asubkey_name)
        Paths.append(winreg.QueryValueEx(asubkey, None)[0])
      else:
        continue
    return Paths
  except:
    return Paths
    
def check_erlang():
  dependence = CDependencies()
  
  base.print_info('Check installed Erlang')
  bReinstallRabbit = False
  erlangPaths = get_erlangPaths()
  
  for i in range(len(erlangPaths)):
    erlangBitness = run_command('cd ' + erlangPaths[i] + '/bin && erl -eval "erlang:display(erlang:system_info(wordsize)), halt()." -noshell')['stdout']
    if (erlangBitness == '8'):
      print("Installed Erlang bitness is valid")
    else:
      if (os.getenv("ERLANG_HOME") == erlangPaths):
        bReinstallRabbit = True
      dependence.pathsToUninstallers.append(erlangPaths[i])
      dependence.namesOfUninstallers.append('Uninstall')
      dependence.paramsForUninstallers.append(r'/S')
      continue
    if (os.getenv("ERLANG_HOME") != erlangPaths[i]):
        bReinstallRabbit = True
    if (bReinstallRabbit == True):
      dependence.progsToInstall.append('RabbitMQ')
    return dependence
          
  print('Erlang x64 not found')
  dependence.progsToInstall.append('Erlang')
  dependence.progsToInstall.append('RabbitMQ')
  return dependence

def check_gruntcli():
  dependence = CDependencies()
  
  base.print_info('Check installed Grunt-Cli')
  result = run_command('npm list -g --depth=0')['stdout']
  
  if (result.find('grunt-cli') == -1):
    print('Grunt-Cli not found')
    dependence.progsToInstall.append('GruntCli')
    return dependence
  
  print('Grunt-Cli is installed')
  return dependence
    
def get_mysqlServersInfo(sParam):
  arrInfo = []
  Path = ""
  
  try:
    keyValue = r"SOFTWARE\WOW6432Node\MySQL AB"
    
    aKey = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, keyValue)
    
    count_subkey = winreg.QueryInfoKey(aKey)[0]
    for i in range(count_subkey):
      asubkey_name = winreg.EnumKey(aKey, i)
      if (asubkey_name.find('MySQL Server') != - 1):
        asubkey = winreg.OpenKey(aKey, asubkey_name)
        Path = winreg.QueryValueEx(asubkey, sParam)[0]
        arrInfo.append(Path)
      else:
        continue
    return arrInfo
  except:
    return arrInfo
    
def check_mysqlInstaller():
  dependence = CDependencies()
  
  try:
    keyValue = r"SOFTWARE\WOW6432Node\MySQL"
    
    aKey = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, keyValue)
    
    count_subkey = winreg.QueryInfoKey(aKey)[0]
    for i in range(count_subkey):
      asubkey_name = winreg.EnumKey(aKey, i)
      if (asubkey_name.find('MySQL Installer') != - 1):
        return dependence
    
    dependence.progsToInstall.append('MySQLInstaller')
    return dependence
  except:
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
      result = run_command('cd ' + mysqlServerPath + 'bin && mysql --version')['stdout']
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
      connectionResult = run_command('cd ' + serversPaths[i] + 'bin && mysql -u root -ponlyoffice -e "SHOW GLOBAL VARIABLES LIKE ' + r"'PORT';" + '"')['stdout']
      if (connectionResult.find('port') != -1 and connectionResult.find('3306') != -1):
        if (run_command('cd ' + serversPaths[i] + 'bin && mysql -u root -ponlyoffice -e "SHOW DATABASES;"')['stdout'].find('onlyoffice') == -1):
          print('Database onlyoffice not found')
          dependence.progsToInstall.append('MySQLDatabase')
        if (run_command('cd ' + serversPaths[i] + 'bin && mysql -u root -ponlyoffice -e "SELECT plugin from mysql.user where User=' + "'root';")['stdout'].find('mysql_native_password') == -1):
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
  result = run_command(os.path.split(os.getcwd())[0] + r'\build_tools\tools\win\vswhere\vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property DisplayName')['stdout']
  if (result == ''):
    dependence.progsToInstall.append('BuildTools')
    return dependence
  
  return dependence
  
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

print(get_erlangPaths())
input()