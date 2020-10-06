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

def installingProgram(sProgram, sParam = ''):
  if (sProgram == 'Node.js'):
    print("Installing Node.js...")
    base.download("https://nodejs.org/dist/latest-v10.x/node-v10.22.1-x64.msi", './nodejs.msi')
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
  elif (sProgram == 'ERLANG_HOME'):
    code = subprocess.call('SETX /M ERLANG_HOME "' + check.get_erlangPath() + '"')
    if (code == 0):
      return True
    else:
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
    code = subprocess.call('"' + os.path.abspath(os.sep) + 'Program Files (x86)\\MySQL\\MySQL Installer for Windows\\MySQLInstallerConsole" community install server;8.0.21;x64:*:type=config;openfirewall=true;generallog=true;binlog=true;serverid=3306;enable_tcpip=true;port=3306;rootpasswd=onlyoffice -silent',  stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
    print(code)
    if (code == 0):
      print("Install success!")
      return True
    else:
      print("Error!")
      return False
  elif (sProgram == 'MySQLDatabase'):
    print('Setting database...')
    subprocess.call('"' + sParam + 'bin\\mysql" -u root -ponlyoffice -e "source ' + os.getcwd() + '\\schema\\mysql\\createdb.sql"', stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
    return True
  elif (sProgram == 'MySQLEncrypt'):
    print('Setting MySQL password encrypting...')
    subprocess.call('"' + sParam + 'bin\\mysql" -u root -ponlyoffice -e "' + "ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'onlyoffice';" + '"', stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
    return True   
  elif (sProgram == "BuildTools"):
    print('Installing Build Tools...')
    base.download("https://download.visualstudio.microsoft.com/download/pr/11503713/e64d79b40219aea618ce2fe10ebd5f0d/vs_BuildTools.exe", './vs_BuildTools.exe')
    code = os.system('vs_BuildTools.exe --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --quiet --wait')
    if (code == 0):
      print("Install success!")
      base.delete_file('./vs_BuildTools.exe')
      return True
    else:
      print("Error!")
      base.delete_file('./vs_BuildTools.exe')
      return False

def deleteProgram(sName):
  print("Deleting " + sName + "...")
  delInfo = check.get_programDelInfo(sName)
  
  for info in delInfo:
    if (base.is_file(info) == False):
      info = info.replace('/I', '/x').replace('/i', '/x')
    else:
      info = '"' + info + '" /S'
      
    print(info)  
    if (os.system(info) != 0):
      print("Deleting was failed!")
      return False
      
  return True
      
  
def installMySQLServer():
  installingProgram('MySQLServer')
  mysqlPaths    = check.get_mysqlServersInfo('Location')
  mysqlVersions = check.get_mysqlServersInfo('Version')

  for i in range(len(mysqlVersions)):
    if (mysqlVersions[i] == '8.0.21'):
      print('Setting MySQL database...')
      subprocess.call('"' + mysqlPaths[i] + 'bin\\mysql" -u root -ponlyoffice -e "source ' + os.getcwd() + '\\schema\\mysql\\createdb.sql"', stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
      subprocess.call('"' + mysqlPaths[i] + 'bin\\mysql" -u root -ponlyoffice -e "' + "ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'onlyoffice';" + '"', stdout=subprocess.PIPE, stderr=subprocess.PIPE, shell=True)
      print('MySQL Server ' + mysqlVersions[i][0:3] + ' is valid')
      return True
  return False
  
try:
  checkResults = check.check_dependencies()
  if (len(checkResults.progsToInstall) > 0):
    if is_admin():
      for program in checkResults.progsToUninstall:
        deleteProgram(program)
        
      for path in checkResults.pathsToRemove:
        shutil.rmtree(path)
        
      for program in checkResults.progsToInstall:
        if (program == 'MySQLDatabase' or program == 'MySQLEncrypt'):
          installingProgram(program, checkResults.pathToValidMySQLServer)
        elif (program == 'MySQLServer'):
          installMySQLServer()
        else:
          installingProgram(program)
      print('All installations completed!')
    else:
      ctypes.windll.shell32.ShellExecuteW(None, unicode("runas"), unicode(sys.executable), unicode(''.join(sys.argv)), None, 1)
      sys.exit(0)
  else:
    base.print_info('All checks complite')
except SystemExit:
  input("Ignoring SystemExit. Press Enter to continue...")

