#!/bin/bash

echo "----------------------------------------"
echo "Copy file to converter"
echo "----------------------------------------"

BASEDIR="$(cd "$(dirname "$0")" && pwd)"

echo "$BASEDIR"

CreateDir() {
    if [ ! -d $1 ]; then
        mkdir -pv $1;
    fi
}

NpmInstall() {
    cd $1
    echo "Module path: $(pwd)"
    npm install
}

RunCommand() {
    TAB_NAME=$1
    COMMAND=$2
    osascript \
        -e "tell application \"Terminal\"" \
        -e "tell application \"System Events\" to keystroke \"t\" using {command down}" \
        -e "do script \"printf '\\\e]1;$TAB_NAME\\\a'; $COMMAND\" in front window" \
        -e "end tell" > /dev/null
}

CreateDir "$BASEDIR/App_Data"
CreateDir "$BASEDIR/FileConverter/bin"
CreateDir "$BASEDIR/FileConverter/bin/core"
CreateDir "$BASEDIR/FileConverter/bin/HtmlFileInternal"

cd "$BASEDIR/FileConverter/bin"

wget -N http://repo-doc-onlyoffice-com.s3.amazonaws.com/mac/core/origin/develop/latest/x64/core.tar.gz
gunzip -c core.tar.gz | tar xopf - -C core

cp -v "core/build/bin/mac_64/icudtl_dat.S" "."
cp -v "core/build/bin/mac_64/x2t" "."
cp -v "core/Common/3dParty/icu/mac_64/build/libicudata.60.dylib" "."
cp -v "core/Common/3dParty/icu/mac_64/build/libicuuc.60.dylib" "."
cp -v "core/Common/3dParty/icu/mac_64/build/libicudata.60.2.dylib" "."
cp -v "core/Common/3dParty/icu/mac_64/build/libicuuc.60.2.dylib" "."
cp -v "core/build/lib/mac_64/libDjVuFile.dylib" "."
cp -v "core/build/lib/mac_64/libHtmlFile.dylib" "."
cp -v "core/build/lib/mac_64/libHtmlRenderer.dylib" "."
cp -v "core/build/lib/mac_64/libPdfReader.dylib" "."
cp -v "core/build/lib/mac_64/libPdfWriter.dylib" "."
cp -v "core/build/lib/mac_64/libUnicodeConverter.dylib" "."
cp -v "core/build/lib/mac_64/libXpsFile.dylib" "."
cp -v "core/build/lib/mac_64/libascdocumentscore.dylib" "."
cp -v "core/build/lib/mac_64/libdoctrenderer.dylib" "."
cp -v "core/build/lib/mac_64/libkernel.dylib" "."

chmod -v +x x2t

SEARCH='..\/..\/OfficeWeb'
REPLACE='..\/..\/..\/sdkjs'
sed "s/$SEARCH/$REPLACE/g" "../../../core/build/lib/DoctRenderer.config" > "DoctRenderer.config"

echo "----------------------------------------"
echo "Font generation "
echo "----------------------------------------"

echo $BASEDIR
cd "$BASEDIR/FileConverter/bin/core/build/bin"
CreateDir "$BASEDIR/../fonts"
chmod -v +x $BASEDIR/FileConverter/bin/core/build/bin/AllFontsGen/mac_64
bash -cv "$BASEDIR/FileConverter/bin/core/build/bin/AllFontsGen/mac_64 '' '$BASEDIR/../sdkjs/Common/AllFonts.js' '$BASEDIR/../sdkjs/Common/Images' '$BASEDIR/FileConverter/bin/font_selection.bin' '$BASEDIR/../fonts'"


echo "----------------------------------------"
echo "Install node.js modules "
echo "----------------------------------------"

NpmInstall "$BASEDIR/DocService"
NpmInstall "$BASEDIR/Common"
NpmInstall "$BASEDIR/FileConverter"
NpmInstall "$BASEDIR/SpellChecker"



echo "----------------------------------------"
echo "Run services"
echo "----------------------------------------"

mysql.server restart
RunCommand "RabbitMQ Server" "/usr/local/sbin/rabbitmq-server"
RunCommand "Redis" "redis-server /usr/local/etc/redis.conf"

RunCommand "Server" "export NODE_CONFIG_DIR=$BASEDIR/Common/config && export NODE_ENV=development-mac && cd $BASEDIR/DocService/sources && node server.js"
RunCommand "GC" "export NODE_CONFIG_DIR=$BASEDIR/Common/config && export NODE_ENV=development-mac && cd $BASEDIR/DocService/sources && node gc.js"
RunCommand "Converter" "export NODE_CONFIG_DIR=$BASEDIR/Common/config && export NODE_ENV=development-mac && export DYLD_LIBRARY_PATH=../../FileConverter/bin/ && cd $BASEDIR/FileConverter/sources && node convertermaster.js"


