import os
import glob
import json
import subprocess
import platform

curDirectory = os.path.dirname(os.path.realpath(__file__))
dictionatiesDirectory = curDirectory + "/../../dictionaries"

all_dictionaties = {}
for dir in glob.glob(dictionatiesDirectory + "/*"):
    if not os.path.isdir(dir):
        continue
    dictionaryName = os.path.basename(dir)
    configFile = dictionatiesDirectory + "/" + dictionaryName + "/" + dictionaryName + ".json"
    if not os.path.isfile(configFile):
        continue
    isHyphen = False
    hyphenFile = dictionatiesDirectory + "/" + dictionaryName + "/hyph_" + dictionaryName + ".dic"
    if os.path.isfile(hyphenFile):
        isHyphen = True
    with open(configFile, 'r', encoding='utf-8') as file:
        data = json.loads(file.read())
        for lang in data["codes"]:
            all_dictionaties[str(lang)] = {
                "name": dictionaryName,
                "hyphen": isHyphen
            }

all_dictionaties_content = json.dumps(all_dictionaties, separators=(",", ":"), sort_keys=True)

sdkjsDirectory = dictionatiesDirectory + "/../sdkjs"

filesReplace = [
    sdkjsDirectory + "/common/spell/spell.js"
]

sdkjsDirectory = dictionatiesDirectory + "/../sdkjs"
for dir in glob.glob(sdkjsDirectory + "/*"):
    if not os.path.isdir(dir):
        continue
    editorName = os.path.basename(dir)
    
    testFile = sdkjsDirectory + "/" + editorName + "/sdk-all-min.js"
    if (os.path.isfile(testFile)):
        filesReplace.append(testFile)

    testFile = sdkjsDirectory + "/" + editorName + "/sdk-all.js"
    if (os.path.isfile(testFile)):
        filesReplace.append(testFile)

for file in filesReplace:
    if not os.path.isfile(file):
        continue
    with open(file, 'r', encoding='utf-8') as f:
        content = f.read()
    startFind = "spellcheckGetLanguages"
    startReplace = "function(){"
    endFind = "};"
    startIndex = content.find(startFind)
    if startIndex == -1:
        continue
    startReplaceIndex = content.find(startReplace, startIndex)
    if startReplaceIndex == -1:
        continue
    endIndex = content.find(endFind, startIndex)
    if endIndex == -1:
        continue
    if content[endIndex + 2:endIndex + 4] == "};":
        endIndex += 2

    content = content[:startReplaceIndex + len(startReplace)] + "return " + all_dictionaties_content + endFind + content[endIndex + len(endFind):]
    with open(file, 'w', encoding='utf-8') as f:
        f.write(content)

testDevelopVersion = sdkjsDirectory + "/.git"
if not os.path.isdir(testDevelopVersion):
    print("Update x2t cache...")
    x2tDir = curDirectory + "/../FileConverter/bin"
    cur_dir = os.getcwd()
    os.chdir(x2tDir)
    x2tBin = curDirectory + "/../FileConverter/bin/x2t"
    if ("windows" == platform.system().lower()):
        subprocess.call(["x2t.exe", "-create-js-cache"], stderr=subprocess.STDOUT, shell=True)
    else:
        subprocess.call("x2t -create-js-cache", stderr=subprocess.STDOUT, shell=True)
    os.chdir(cur_dir)
