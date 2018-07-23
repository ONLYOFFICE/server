OUTPUT_DIR = build/server
OUTPUT = $(OUTPUT_DIR)

GRUNT = grunt
GRUNT_FLAGS = --no-color -v 

GRUNT_FILES = Gruntfile.js.out

PRODUCT_VERSION ?= 0.0.0
BUILD_NUMBER ?= 0

ifeq ($(OS),Windows_NT)
    PLATFORM := win
    EXEC_EXT := .exe
    SHARED_EXT := .dll
    ifeq ($(PROCESSOR_ARCHITECTURE),AMD64)
        ARCHITECTURE := 64
    endif
    ifeq ($(PROCESSOR_ARCHITECTURE),x86)
        ARCHITECTURE := 32
    endif
else
    UNAME_S := $(shell uname -s)
    ifeq ($(UNAME_S),Linux)
        PLATFORM := linux
        SHARED_EXT := .so*
    endif
    UNAME_M := $(shell uname -m)
    ifeq ($(UNAME_M),x86_64)
        ARCHITECTURE := 64
    endif
    ifneq ($(filter %86,$(UNAME_M)),)
        ARCHITECTURE := 32
    endif
endif

TARGET := $(PLATFORM)_$(ARCHITECTURE)

FILE_CONVERTER = $(OUTPUT)/FileConverter/bin
FILE_CONVERTER_FILES += ../core/build/lib/$(TARGET)/*$(SHARED_EXT)

ifeq ($(PLATFORM),linux)
FILE_CONVERTER_FILES += ../core/Common/3dParty/icu/$(TARGET)/build/libicudata$(SHARED_EXT)
FILE_CONVERTER_FILES += ../core/Common/3dParty/icu/$(TARGET)/build/libicuuc$(SHARED_EXT)
endif

ifeq ($(PLATFORM),win)
FILE_CONVERTER_FILES += ../core/Common/3dParty/icu/$(TARGET)/build/icudt55$(SHARED_EXT)
FILE_CONVERTER_FILES += ../core/Common/3dParty/icu/$(TARGET)/build/icuuc55$(SHARED_EXT)
FILE_CONVERTER_FILES += ../core/Common/3dParty/v8/$(TARGET)/release/icudt.dll
endif

FILE_CONVERTER_FILES += ../core/build/bin/$(TARGET)/x2t$(EXEC_EXT)

DOC_BUILDER_FILES += ../core/build/bin/$(TARGET)/docbuilder$(EXEC_EXT)
DOC_BUILDER_FILES += ../core/Common/empty

HTML_FILE_INTERNAL := $(FILE_CONVERTER)/HtmlFileInternal
HTML_FILE_INTERNAL_FILES += ../core/build/lib/$(TARGET)/HtmlFileInternal$(EXEC_EXT)
HTML_FILE_INTERNAL_FILES += ../core/Common/3dParty/cef/$(TARGET)/build/**

SPELLCHECKER_DICTIONARIES := $(OUTPUT)/SpellChecker/dictionaries
SPELLCHECKER_DICTIONARY_FILES += ../dictionaries/**

SCHEMA_DIR = schema
SCHEMA_FILES = $(SCHEMA_DIR)/**
SCHEMA = $(OUTPUT)/$(SCHEMA_DIR)/

TOOLS_DIR = tools
TOOLS_FILES = ../core/build/bin/AllFontsGen/$(TARGET)
TOOLS = $(OUTPUT)/$(TOOLS_DIR)

LICENSE_FILES = LICENSE.txt 3rd-Party.txt license/
LICENSE = $(addsuffix $(OUTPUT)/, LICENSE_FILES)

LICENSE_JS := $(OUTPUT)/Common/sources/license.js
COMMON_DEFINES_JS := $(OUTPUT)/Common/sources/commondefines.js

WELCOME_DIR = welcome
WELCOME_FILES = $(WELCOME_DIR)/**
WELCOME = $(OUTPUT)/$(WELCOME_DIR)/

.PHONY: all clean install uninstall build-date htmlfileinternal docbuilder

.NOTPARALLEL:
all: $(FILE_CONVERTER) $(SPELLCHECKER_DICTIONARIES) $(TOOLS) $(SCHEMA) $(LICENSE) $(WELCOME) build-date

ext: htmlfileinternal docbuilder

build-date: $(GRUNT_FILES)
	sed "s|\(const buildVersion = \).*|\1'${PRODUCT_VERSION}';|" -i $(COMMON_DEFINES_JS)
	sed "s|\(const buildNumber = \).*|\1${BUILD_NUMBER};|" -i $(COMMON_DEFINES_JS)
	sed "s|\(const buildDate = \).*|\1'$$(date +%F)';|" -i $(LICENSE_JS)
	
htmlfileinternal: $(FILE_CONVERTER)
	mkdir -p $(HTML_FILE_INTERNAL) && \
		cp -r -t $(HTML_FILE_INTERNAL) $(HTML_FILE_INTERNAL_FILES)

docbuilder: $(FILE_CONVERTER)
	cp -r -t $(FILE_CONVERTER) $(DOC_BUILDER_FILES)

$(FILE_CONVERTER): $(GRUNT_FILES)
	mkdir -p $(FILE_CONVERTER) && \
		cp -r -t $(FILE_CONVERTER) $(FILE_CONVERTER_FILES)

$(SPELLCHECKER_DICTIONARIES): $(GRUNT_FILES)
	mkdir -p $(SPELLCHECKER_DICTIONARIES) && \
		cp -r -t $(SPELLCHECKER_DICTIONARIES) $(SPELLCHECKER_DICTIONARY_FILES)

$(SCHEMA):
	mkdir -p $(SCHEMA) && \
		cp -r -t $(SCHEMA) $(SCHEMA_FILES)
		
$(TOOLS):
	mkdir -p $(TOOLS) && \
		cp -r -t $(TOOLS) $(TOOLS_FILES) && \
		mv $(TOOLS)/$(TARGET)$(EXEC_EXT) $(TOOLS)/AllFontsGen$(EXEC_EXT)
		
$(LICENSE):
	mkdir -p $(OUTPUT) && \
		cp -r -t $(OUTPUT) $(LICENSE_FILES)
		
$(GRUNT_FILES):
	cd $(@D) && \
		npm install && \
		$(GRUNT) $(GRUNT_FLAGS)
	echo "Done" > $@

$(WELCOME):
	mkdir -p $(WELCOME) && \
		cp -r -t $(WELCOME) $(WELCOME_FILES)

clean:
	rm -rf $(OUTPUT) $(GRUNT_FILES)

install:
	sudo adduser --quiet --home /var/www/onlyoffice --system --group onlyoffice

	sudo mkdir -p /var/www/onlyoffice/documentserver
	sudo mkdir -p /var/log/onlyoffice/documentserver
	sudo mkdir -p /var/lib/onlyoffice/documentserver/App_Data
	
	sudo cp -fr -t /var/www/onlyoffice/documentserver build/* ../web-apps/deploy/*
	sudo mkdir -p /etc/onlyoffice/documentserver
	sudo mv /var/www/onlyoffice/documentserver/server/Common/config/* /etc/onlyoffice/documentserver
	
	sudo chown onlyoffice:onlyoffice -R /var/www/onlyoffice
	sudo chown onlyoffice:onlyoffice -R /var/log/onlyoffice
	sudo chown onlyoffice:onlyoffice -R /var/lib/onlyoffice

	sudo ln -s /var/www/onlyoffice/documentserver/server/FileConverter/bin/libDjVuFile.so /lib/libDjVuFile.so
	sudo ln -s /var/www/onlyoffice/documentserver/server/FileConverter/bin/libdoctrenderer.so /lib/libdoctrenderer.so
	sudo ln -s /var/www/onlyoffice/documentserver/server/FileConverter/bin/libHtmlFile.so /lib/libHtmlFile.so
	sudo ln -s /var/www/onlyoffice/documentserver/server/FileConverter/bin/libHtmlRenderer.so /lib/libHtmlRenderer.so
	sudo ln -s /var/www/onlyoffice/documentserver/server/FileConverter/bin/libPdfReader.so /lib/libPdfReader.so
	sudo ln -s /var/www/onlyoffice/documentserver/server/FileConverter/bin/libPdfWriter.so /lib/libPdfWriter.so
	sudo ln -s /var/www/onlyoffice/documentserver/server/FileConverter/bin/libXpsFile.so /lib/libXpsFile.so
	sudo ln -s /var/www/onlyoffice/documentserver/server/FileConverter/bin/libUnicodeConverter.so /lib/libUnicodeConverter.so
	sudo ln -s /var/www/onlyoffice/documentserver/server/FileConverter/bin/libicudata.so.55 /lib/libicudata.so.55
	sudo ln -s /var/www/onlyoffice/documentserver/server/FileConverter/bin/libicuuc.so.55 /lib/libicuuc.so.55

	sudo -u onlyoffice "/var/www/onlyoffice/documentserver/server/tools/AllFontsGen"\
		"/usr/share/fonts"\
		"/var/www/onlyoffice/documentserver/sdkjs/common/AllFonts.js"\
		"/var/www/onlyoffice/documentserver/sdkjs/common/Images"\
		"/var/www/onlyoffice/documentserver/server/FileConverter/bin/font_selection.bin"
uninstall:
	sudo userdel onlyoffice
	
	sudo unlink /lib/libDjVuFile.so
	sudo unlink /lib/libdoctrenderer.so
	sudo unlink /lib/libHtmlFile.so
	sudo unlink /lib/libHtmlRenderer.so
	sudo unlink /lib/libPdfReader.so
	sudo unlink /lib/libPdfWriter.so
	sudo unlink /lib/libXpsFile.so
	sudo unlink /lib/libUnicodeConverter.so
	sudo unlink /lib/libicudata.so.55
	sudo unlink /lib/libicuuc.so.55

	sudo rm -rf /var/www/onlyoffice/documentserver
	sudo rm -rf /var/log/onlyoffice/documentserver
	sudo rm -rf /var/lib/onlyoffice/documentserver	
	sudo rm -rf /etc/onlyoffice/documentserver
