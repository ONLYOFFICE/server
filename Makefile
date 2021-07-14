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

OUTPUT = ../build_tools/out/$(TARGET)/onlyoffice/documentserver/server

SPELLCHECKER_DICTIONARIES := $(OUTPUT)/dictionaries
SPELLCHECKER_DICTIONARY_FILES += ../dictionaries/*_*

SCHEMA_DIR = schema
SCHEMA_FILES = $(SCHEMA_DIR)/**
SCHEMA = $(OUTPUT)/$(SCHEMA_DIR)/

TOOLS_DIR = tools
TOOLS_FILES += ../core/build/bin/$(TARGET)/allfontsgen$(EXEC_EXT)
TOOLS_FILES += ../core/build/bin/$(TARGET)/allthemesgen$(EXEC_EXT)
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

DEBUG = $(BRANDING_DIR)/debug.js

.PHONY: all clean install uninstall build-date

.NOTPARALLEL:
all: $(SPELLCHECKER_DICTIONARIES) $(TOOLS) $(SCHEMA) $(CORE_FONTS) $(LICENSE) $(WELCOME) $(INFO) build-date

build-date: $(GRUNT_FILES)
	sed "s|\(const buildVersion = \).*|\1'${PRODUCT_VERSION}';|" -i $(COMMON_DEFINES_JS)
	sed "s|\(const buildNumber = \).*|\1${BUILD_NUMBER};|" -i $(COMMON_DEFINES_JS)
	sed "s|\(const buildDate = \).*|\1'$$(date +%F)';|" -i $(LICENSE_JS)
	test -e $(DEBUG) && \
	cp $(DEBUG) $(OUTPUT)/Common/sources || true

$(SPELLCHECKER_DICTIONARIES): $(GRUNT_FILES)
	mkdir -p $(SPELLCHECKER_DICTIONARIES) && \
		cp -r -t $(SPELLCHECKER_DICTIONARIES) $(SPELLCHECKER_DICTIONARY_FILES)

$(SCHEMA):
	mkdir -p $(SCHEMA) && \
		cp -r -t $(SCHEMA) $(SCHEMA_FILES)

$(TOOLS):
	mkdir -p $(TOOLS) && \
		cp -r -t $(TOOLS) $(TOOLS_FILES)

$(LICENSE):
	mkdir -p $(OUTPUT) && \
		cp -r -t $(OUTPUT) $(LICENSE_FILES)

$(GRUNT_FILES):
	cd $(@D) && \
		npm install && \
		$(GRUNT_ENV) $(GRUNT) $(GRUNT_FLAGS)
		mkdir -p $(OUTPUT)
		cp -r -t $(OUTPUT) ./build/server/*
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
	rm -rf $(GRUNT_FILES)

install:
	mkdir -pv ${DESTDIR}/var/www/onlyoffice
	if ! id -u onlyoffice > /dev/null 2>&1; then useradd -m -d /var/www/onlyoffice -r -U onlyoffice; fi

	mkdir -p ${DESTDIR}${DOCUMENT_ROOT}/fonts
	mkdir -p ${DESTDIR}/var/log/onlyoffice/documentserver
	mkdir -p ${DESTDIR}/var/lib/onlyoffice/documentserver/App_Data

	cp -fr -t ${DESTDIR}${DOCUMENT_ROOT} build/* ../web-apps/deploy/*
	mkdir -p ${DESTDIR}/etc/onlyoffice/documentserver
	mv ${DESTDIR}${DOCUMENT_ROOT}/server/Common/config/* ${DESTDIR}/etc/onlyoffice/documentserver

	chown onlyoffice:onlyoffice -R ${DESTDIR}/var/www/onlyoffice
	chown onlyoffice:onlyoffice -R ${DESTDIR}/var/log/onlyoffice
	chown onlyoffice:onlyoffice -R ${DESTDIR}/var/lib/onlyoffice

	# Make symlinks for shared libs
	find \
		${DESTDIR}${DOCUMENT_ROOT}/server/FileConverter/bin \
		-maxdepth 1 \
		-name *$(SHARED_EXT) \
		-exec sh -c 'ln -sf {} ${DESTDIR}/lib/$$(basename {})' \;

	sudo -u onlyoffice "${DESTDIR}${DOCUMENT_ROOT}/server/tools/allfontsgen"\
		--input="${DESTDIR}${DOCUMENT_ROOT}/core-fonts"\
		--allfonts-web="${DESTDIR}${DOCUMENT_ROOT}/sdkjs/common/AllFonts.js"\
		--allfonts="${DESTDIR}${DOCUMENT_ROOT}/server/FileConverter/bin/AllFonts.js"\
		--images="${DESTDIR}${DOCUMENT_ROOT}/sdkjs/common/Images"\
		--selection="${DESTDIR}${DOCUMENT_ROOT}/server/FileConverter/bin/font_selection.bin"\
		--output-web="${DESTDIR}${DOCUMENT_ROOT}/fonts"\
		--use-system="true"

	sudo -u onlyoffice "${DESTDIR}${DOCUMENT_ROOT}/server/tools/allthemesgen"\
		--converter-dir="${DESTDIR}${DOCUMENT_ROOT}/server/FileConverter/bin"\
		--src="${DESTDIR}${DOCUMENT_ROOT}/sdkjs/slide/themes"\
		--output="${DESTDIR}${DOCUMENT_ROOT}/sdkjs/common/Images"

uninstall:
	userdel onlyoffice

	# Unlink installed shared libs
	find /lib -type l | while IFS= read -r lnk; do if (readlink "$$lnk" | grep -q '^${DOCUMENT_ROOT}/server/FileConverter/bin/'); then rm "$$lnk"; fi; done

	rm -rf /var/www/onlyoffice/documentserver
	rm -rf /var/log/onlyoffice/documentserver
	rm -rf /var/lib/onlyoffice/documentserver
	rm -rf /etc/onlyoffice/documentserver
