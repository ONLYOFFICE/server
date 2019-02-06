OUTPUT_DIR = build/server
OUTPUT = $(OUTPUT_DIR)

GRUNT = grunt
GRUNT_FLAGS = --no-color -v 

GRUNT_FILES = Gruntfile.js.out

PRODUCT_VERSION ?= 0.0.0
BUILD_NUMBER ?= 0

PUBLISHER_NAME ?= Ascensio System SIA
PUBLISHER_URL ?= https://www.onlyoffice.com/

GRUNT_ENV += PRODUCT_VERSION=$(PRODUCT_VERSION)
GRUNT_ENV += BUILD_NUMBER=$(BUILD_NUMBER)
GRUNT_ENV += PUBLISHER_NAME="$(PUBLISHER_NAME)"
GRUNT_ENV += PUBLISHER_URL="$(PUBLISHER_URL)"

BRANDING_DIR ?= ./branding

DOCUMENT_ROOT ?= /var/www/onlyoffice/documentserver

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
        LIB_PREFIX := lib
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
FILE_CONVERTER_FILES += ../core/build/lib/$(TARGET)/$(LIB_PREFIX)DjVuFile$(SHARED_EXT)
FILE_CONVERTER_FILES += ../core/build/lib/$(TARGET)/$(LIB_PREFIX)doctrenderer$(SHARED_EXT)
FILE_CONVERTER_FILES += ../core/build/lib/$(TARGET)/$(LIB_PREFIX)graphics$(SHARED_EXT)
FILE_CONVERTER_FILES += ../core/build/lib/$(TARGET)/$(LIB_PREFIX)HtmlFile$(SHARED_EXT)
FILE_CONVERTER_FILES += ../core/build/lib/$(TARGET)/$(LIB_PREFIX)HtmlRenderer$(SHARED_EXT)
FILE_CONVERTER_FILES += ../core/build/lib/$(TARGET)/$(LIB_PREFIX)kernel$(SHARED_EXT)
FILE_CONVERTER_FILES += ../core/build/lib/$(TARGET)/$(LIB_PREFIX)PdfReader$(SHARED_EXT)
FILE_CONVERTER_FILES += ../core/build/lib/$(TARGET)/$(LIB_PREFIX)PdfWriter$(SHARED_EXT)
FILE_CONVERTER_FILES += ../core/build/lib/$(TARGET)/$(LIB_PREFIX)UnicodeConverter$(SHARED_EXT)
FILE_CONVERTER_FILES += ../core/build/lib/$(TARGET)/$(LIB_PREFIX)XpsFile$(SHARED_EXT)

ifeq ($(PLATFORM),linux)
FILE_CONVERTER_FILES += ../core/Common/3dParty/icu/$(TARGET)/build/libicudata$(SHARED_EXT)
FILE_CONVERTER_FILES += ../core/Common/3dParty/icu/$(TARGET)/build/libicuuc$(SHARED_EXT)
FILE_CONVERTER_FILES += ../core/Common/3dParty/v8/v8/out.gn/$(TARGET)/icudtl.dat
endif

ifeq ($(PLATFORM),win)
FILE_CONVERTER_FILES += ../core/Common/3dParty/icu/$(TARGET)/build/icudt*$(SHARED_EXT)
FILE_CONVERTER_FILES += ../core/Common/3dParty/icu/$(TARGET)/build/icuuc*$(SHARED_EXT)
FILE_CONVERTER_FILES += ../core/Common/3dParty/v8/v8/out.gn/$(TARGET)/release/icudtl.dat
endif

FILE_CONVERTER_FILES += ../core/build/bin/$(TARGET)/x2t$(EXEC_EXT)

DOC_BUILDER_FILES += ../core/build/bin/$(TARGET)/docbuilder$(EXEC_EXT)
DOC_BUILDER_FILES += ../core/Common/empty

HTML_FILE_INTERNAL := $(FILE_CONVERTER)/HtmlFileInternal
HTML_FILE_INTERNAL_FILES += ../core/build/lib/$(TARGET)/HtmlFileInternal$(EXEC_EXT)
HTML_FILE_INTERNAL_FILES += ../core/Common/3dParty/cef/$(TARGET)/build/**

SPELLCHECKER_DICTIONARIES := $(OUTPUT)/SpellChecker/dictionaries
SPELLCHECKER_DICTIONARY_FILES += ../dictionaries/*_*

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
WELCOME_FILES = $(BRANDING_DIR)/$(WELCOME_DIR)/**
WELCOME = $(OUTPUT)/$(WELCOME_DIR)/

INFO_DIR = info
INFO_FILES = $(BRANDING_DIR)/$(INFO_DIR)/**
INFO = $(OUTPUT)/$(INFO_DIR)/

CORE_FONTS_DIR = core-fonts
CORE_FONTS_FILES = ../$(CORE_FONTS_DIR)/**
CORE_FONTS = $(OUTPUT)/../$(CORE_FONTS_DIR)/

.PHONY: all clean install uninstall build-date htmlfileinternal docbuilder

.NOTPARALLEL:
all: $(FILE_CONVERTER) $(SPELLCHECKER_DICTIONARIES) $(TOOLS) $(SCHEMA) $(CORE_FONTS) $(LICENSE) $(WELCOME) $(INFO) build-date

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
		$(GRUNT_ENV) $(GRUNT) $(GRUNT_FLAGS)
	echo "Done" > $@

$(WELCOME):
	mkdir -p $(WELCOME) && \
		cp -r -t $(WELCOME) $(WELCOME_FILES)

$(INFO):
	mkdir -p $(INFO) && \
		cp -r -t $(INFO) $(INFO_FILES)

$(CORE_FONTS):
	mkdir -p $(CORE_FONTS) && \
		cp -r -t $(CORE_FONTS) $(CORE_FONTS_FILES)
		
clean:
	rm -rf $(CORE_FONTS) $(OUTPUT) $(GRUNT_FILES) 

install:
	mkdir -pv /var/www/onlyoffice
	if ! id -u onlyoffice > /dev/null 2>&1; then useradd -m -d /var/www/onlyoffice -r -U onlyoffice; fi

	mkdir -p /var/www/onlyoffice/documentserver
	mkdir -p /var/www/onlyoffice/documentserver/fonts
	mkdir -p /var/log/onlyoffice/documentserver
	mkdir -p /var/lib/onlyoffice/documentserver/App_Data
	
	cp -fr -t /var/www/onlyoffice/documentserver build/* ../web-apps/deploy/*
	mkdir -p /etc/onlyoffice/documentserver
	mv /var/www/onlyoffice/documentserver/server/Common/config/* /etc/onlyoffice/documentserver
	
	chown onlyoffice:onlyoffice -R /var/www/onlyoffice
	chown onlyoffice:onlyoffice -R /var/log/onlyoffice
	chown onlyoffice:onlyoffice -R /var/lib/onlyoffice

	# Make symlinks for shared libs
	find \
		${DOCUMENT_ROOT}/server/FileConverter/bin \
		-maxdepth 1 \
		-name *$(SHARED_EXT) \
		-exec sh -c 'ln -sf {} /lib/$$(basename {})' \;

	sudo -u onlyoffice "${DOCUMENT_ROOT}/server/tools/AllFontsGen"\
		--input="${DOCUMENT_ROOT}/core-fonts"\
		--allfonts-web="${DOCUMENT_ROOT}/sdkjs/common/AllFonts.js"\
		--allfonts="${DOCUMENT_ROOT}/server/FileConverter/bin/AllFonts.js"\
		--images="${DOCUMENT_ROOT}/sdkjs/common/Images"\
		--selection="${DOCUMENT_ROOT}/server/FileConverter/bin/font_selection.bin"\
		--output-web="${DOCUMENT_ROOT}/fonts"\
		--use-system="true"

uninstall:
	userdel onlyoffice
	
	# Unlink installed shared libs
	find /lib -type l | while IFS= read -r lnk; do if (readlink "$$lnk" | grep -q '^${DOCUMENT_ROOT}/server/FileConverter/bin/'); then rm "$$lnk"; fi; done

	rm -rf /var/www/onlyoffice/documentserver
	rm -rf /var/log/onlyoffice/documentserver
	rm -rf /var/lib/onlyoffice/documentserver	
	rm -rf /etc/onlyoffice/documentserver
