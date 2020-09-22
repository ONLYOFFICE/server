import sys
sys.path.append('../build_tools/scripts')
import os
import base
import subprocess
import ctypes
import checks_develop as check
import shutil

if (sys.version_info[0] >= 3):
  unicode = str
    
def is_admin():
  try:
    return ctypes.windll.shell32.IsUserAnAdmin()
  except:
    return False

def installingProgram(sProgram, bSilent = False):
  if (sProgram == 'Node.js'):
    print("Installing Node.js...")
    base.download("https://nodejs.org/dist/latest-v10.x/node-v10.22.0-x64.msi", './nodejs.msi')
    code = subprocess.call('msiexec.exe /i nodejs.msi /qn',  stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
    if (code == 0):
      print("Install success!")
      base.delete_file('./nodejs.msi')
      return True
    else:
      print("Error!")
      base.delete_file('./nodejs.msi')
      return False
  elif (sProgram == 'Java'):
    print("Installing Java...")
    base.download("https://javadl.oracle.com/webapps/download/AutoDL?BundleId=242990_a4634525489241b9a9e1aa73d9e118e6", './java.exe')
    code = subprocess.call('java.exe /s',  stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
    if (code == 0):
      print("Install success!")
      base.delete_file('./java.exe')
      return True
    else:
      print("Error!")
      base.delete_file('./java.exe')
      return False
  elif (sProgram == 'RabbitMQ'):
    print("Installing RabbitMQ...")
    base.download("https://github.com/rabbitmq/rabbitmq-server/releases/download/v3.8.8/rabbitmq-server-3.8.8.exe", './rabbitmq.exe')
    code = subprocess.call('rabbitmq.exe /S',  stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
    if (code == 0):
      print("Install success!")
      base.delete_file('./rabbitmq.exe')
      return True
    else:
      print("Error!")
      base.delete_file('./rabbitmq.exe')
      return False
  elif (sProgram == 'Erlang'):
    print("Installing Erlang...")
    base.download("http://erlang.org/download/otp_win64_23.0.exe", './erlang.exe')
    code = subprocess.call('erlang.exe /S',  stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
    if (code == 0):
      print("Install success!")
      base.delete_file('./erlang.exe')
      return True
    else:
      print("Error!")
      base.delete_file('./erlang.exe')
      return False
  elif (sProgram == 'GruntCli'):
    print('Installing Grunt-Cli...')
    code = subprocess.call('npm install -g grunt-cli',  stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
    if (code == 0):
      print("Install success!")
      return True
    else:
      print("Error!")
      return False
  elif (sProgram == 'MySQLInstaller'):
    print('Installing MySQL Installer...')
    base.download("https://dev.mysql.com/get/Downloads/MySQLInstaller/mysql-installer-web-community-8.0.21.0.msi", './mysqlinstaller.msi')
    code = subprocess.call('msiexec.exe /i mysqlinstaller.msi /qn',  stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
    if (code == 0):
      print("Install success!")
      base.delete_file('./mysqlinstaller.msi')
      return True
    else:
      print("Error!")
      base.delete_file('./mysqlinstaller.msi')
      return False
  elif (sProgram == 'MySQLServer'):
    print('Installing MySQL Server...')
    code = subprocess.call('cd C:\Program Files (x86)\MySQL\MySQL Installer for Windows && MySQLInstallerConsole.exe community install server;8.0.21;x64:*:type=config;openfirewall=true;generallog=true;binlog=true;serverid=3306;enable_tcpip=true;port=3306;rootpasswd=onlyoffice -silent',  stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
    if (code == 0):
      print("Install success!")
      return True
    else:
      print("Error!")
      return False
  elif (sProgram == "Build Tools"):
    print('Installing Build Tools...')
    base.download("https://download.visualstudio.microsoft.com/download/pr/11503713/e64d79b40219aea618ce2fe10ebd5f0d/vs_BuildTools.exe", './vs_BuildTools.exe')
    code = subprocess.call('vs_buildtools.exe --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --quiet --wait',  stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
    if (code == 0):
      print("Install success!")
      base.delete_file('./vs_buildtools.exe')
      return True
    else:
      print("Error!")
      base.delete_file('./vs_buildtools.exe')
      return False

def deleteProgram(sName):
  if (sName == 'Erlang'):
    print("Deleting " + sName + "...")
    code = subprocess.call('cd ' + check.get_erlangPath() + ' && Uninstall.exe /S', stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
    if (code == 0):
      print("Delete success!")
      return True
    else:
      print("Error!")
      return False
  
  if is_admin():
    print("Deleting " + sName + "...")
    code = subprocess.call('wmic product where name="' + sName + '" call uninstall',  stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
    if (code == 0):
      print("Delete success!")
      return True
    else:
      print("Error!")
      return False
  else:
    ctypes.windll.shell32.ShellExecuteW(None, u"runas", unicode(sys.executable), unicode(''.join(sys.argv)), None, 1)
    sys.exit() 

def installNodejs(installedVersion):
  if (installedVersion == ''):
    print('Node.js not found.')
  else:
    print('Installed Node.js version: ' + str(installedVersion))
    
  nodejs_min_version = 8
  nodejs_max_version = 10
  if (installedVersion == ''):
    return installingProgram('Node.js')
  elif (nodejs_min_version > installedVersion or installedVersion > nodejs_max_version):
    print('Node.js version must be 8.x to 10.x')
    deleteProgram('Node.js')
    return installingProgram('Node.js')
  else:
    print('Valid Node.js version')
    return True
 
def installJava(javaBitness):
  if (javaBitness == ''):
    print('Java not found.') 
    return installingProgram('Java')
  elif (javaBitness == 'x32'):
    print('Installed java: ' + javaBitness)
    print('Java bitness must be x64')
    return installingProgram('Java')
  elif (javaBitness == 'x64'):
    print('Valid Java bitness')
    return True
    
def installRabbitMQ(result):
  if (result.find('RabbitMQ') == -1):
    return installingProgram('RabbitMQ')
  else:
    print('RabbitMQ is installed')
    return True
 
def installErlang(result):
  if (result == None):
    installingProgram('Erlang')
    installingProgram('RabbitMQ')
    path = check.get_erlangPath()
    code = subprocess.call('SETX /M ERLANG_HOME "' + path + '"')
    if (code == 0):
      return True
    else:
      return False
  elif (result == '4'):
    print('Erlang bitness (x32) is not valid') 
    deleteProgram('Erlang')
    if (True != installingProgram('Erlang')):
      exit(0)
    installingProgram('RabbitMQ')
  elif (result == '8'):
    if (os.getenv("ERLANG_HOME") != check.get_erlangPath()):
      path = check.get_erlangPath()
      code = subprocess.call('SETX /M ERLANG_HOME "' + path + '"')
      if (code == 0):
        return True
      else:
        return False
    print("Erlang is valid")
    return True

def installGruntCli(result):
  if (result == False):
    print('Grunt-Cli not found')
    return installingProgram('GruntCli')
  else:
    print('Grunt-Cli is installed')
    return True
    
def installMySQLServer(serversBitness, serversVersions, serversPaths, dataPaths):
  for i in range(len(serversBitness)):
    result = serversBitness[i]
    if (result == ""):
      continue 
    elif (result == 'x32'):
      print('MySQL Server bitness is x32, is not valid')
      deleteProgram('MySQL Server ' + serversVersions[i][0:3])
      continue
    elif (result == 'x64'):
      connectionResult = check.run_command('cd ' + serversPaths[i] + 'bin && mysql -u root -ponlyoffice -e "SHOW GLOBAL VARIABLES LIKE ' + r"'PORT';" + '"')['stdout']
      if (connectionResult.find('port') != -1 and connectionResult.find('3306') != -1):
        if (check.run_command('cd ' + serversPaths[i] + 'bin && mysql -u root -ponlyoffice -e "SHOW DATABESES;')['stdout'].find('onlyoffice') == -1):
          subprocess.call('cd ' + serversPaths[i] + 'bin && mysql -u root -ponlyoffice -e "source ./schema\mysql\createdb.sql"', stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
          subprocess.call('cd ' + serversPaths[i] + 'bin && mysql -u root -ponlyoffice -e "' + "ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'onlyoffice';" + '"', stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
        print('MySQL Server ' + serversVersions[i][0:3] + ' is valid')
        return True
      else:
        print('MySQL Server configuration is not valid')
        deleteProgram('MySQL Server ' + serversVersions[i][0:3])
        shutil.rmtree(dataPaths[i])
        continue
      
  if (True != installingProgram('MySQLInstaller')):
    deleteProgram('MySQL Installer - Community')
    if (True != installingProgram('MySQLInstaller')):
      return False
      
  installingProgram('MySQLServer')
  dirPaths = check.get_mysqlServersPaths()
  
  for i in range(len(dirPaths)):
    if (dirPaths[i].find('Server 8.0') != -1):
      connectionResult = run_command('cd ' + dirPaths[i] + 'bin && mysql -u root -ponlyoffice -e "SHOW GLOBAL VARIABLES LIKE ' + r"'PORT';" + '"')['stdout']
      if (connectionResult.find('port') != -1 and connectionResult.find('3306') != -1):
        if (run_command('cd ' + dirPaths[i] + 'bin && mysql -u root -ponlyoffice -e "SHOW DATABESES;')['stdout'].find('onlyoffice') == -1):
          subprocess.call('cd ' + dirPaths[i] + 'bin && mysql -u root -ponlyoffice -e "source ./schema\mysql\createdb.sql"', stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
          subprocess.call('cd ' + dirPaths[i] + 'bin && mysql -u root -ponlyoffice -e "' + "ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'onlyoffice';" + '"', stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
        print('MySQL Server 8.0 is valid')
        return True
    else:
      continue
      
  return False
      
        
try:
  if is_admin():
    base.print_info('Check Node.js version')
    installNodejs(check.check_nodejs_version())
    base.print_info('Check Java bitness')
    installJava(check.check_java_bitness())
    base.print_info('Check Erlang')
    installErlang(check.check_erlang())
    base.print_info('Check RabbitMQ')
    installRabbitMQ(check.check_rabbitmq())
    base.print_info('Check Grunt-Cli')
    installGruntCli(check.check_gruntcli())
    base.print_info('Check MySQL Server')
    installMySQLServer(check.check_mysqlServersBitness(check.get_mysqlServersPaths()), check.get_mysqlServersVersions(), check.get_mysqlServersPaths(), check.get_mysqlServersDataPaths())
    #base.print_info('Check Build Tools')
    #installMySQLServer(check.check_mysqlServersBitness(check.get_mysqlServersPaths()), check.get_mysqlServersVersions(), check.get_mysqlServersPaths(), check.get_mysqlServersDataPaths())
  else:
    ctypes.windll.shell32.ShellExecuteW(None, unicode("runas"), unicode(sys.executable), unicode(''.join(sys.argv)), None, 1)
    sys.exit(0)
except SystemExit:
  input("Ignoring SystemExit. Press Enter to continue...")
  
  

