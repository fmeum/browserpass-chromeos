VERSION ?= $(shell cat .version)

CLEAN_FILES := chromium dist dist-webstore
CHROME := $(shell which chromium 2>/dev/null || which chromium-browser 2>/dev/null || which chrome 2>/dev/null || which google-chrome 2>/dev/null || which google-chrome-stable 2>/dev/null)

#######################
# For local development

.PHONY: all
all: extension chromium

.PHONY: extension
extension:
	$(MAKE) -C src

EXTENSION_FILES := \
	src/fonts/*
EXTENSION_FILES := \
    $(wildcard $(EXTENSION_FILES)) \
	src/make-persistent/make-persistent-iframe.html \
	src/make-persistent/make-persistent-iframe.js \
	src/make-persistent/make-persistent.js \
	src/options/options.html \
	src/options/options.js \
	src/background.html \
	src/background.js \
	src/errors.js \
	src/files.js \
	src/validator.js \
	src/dist/request.dist.js
CHROMIUM_FILES := $(patsubst src/%,chromium/%, $(EXTENSION_FILES))

.PHONY: chromium
chromium: extension $(CHROMIUM_FILES) chromium/manifest.json

$(CHROMIUM_FILES) : chromium/% : src/%
	[ -d $(dir $@) ] || mkdir -p $(dir $@)
	cp $< $@

chromium/manifest.json : src/manifest-chromium.json
	[ -d $(dir $@) ] || mkdir -p $(dir $@)
	cp $< $@

#######################
# For official releases

.PHONY: clean
clean:
	rm -rf $(CLEAN_FILES)
	$(MAKE) -C src clean

.PHONY: crx-webstore
crx-webstore:
	"$(CHROME)" --disable-gpu --pack-extension=./chromium --pack-extension-key=webstore.pem
	mv chromium.crx browserpass-chromeos-webstore.crx

.PHONY: crx-github
crx-github:
	"$(CHROME)" --disable-gpu --pack-extension=./chromium --pack-extension-key=github.pem
	mv chromium.crx browserpass-chromeos-github.crx

.PHONY: dist
dist: clean extension chromium crx-webstore crx-github
	mkdir -p dist

	git archive -o dist/browserpass-chromeos-$(VERSION).tar.gz --format tar.gz --prefix=browserpass-chromeos-$(VERSION)/ $(VERSION)

	(cd chromium && zip -r ../dist/browserpass-chromeos-chromium-$(VERSION).zip *)

	mv browserpass-chromeos-webstore.crx dist/browserpass-chromeos-webstore-$(VERSION).crx
	mv browserpass-chromeos-github.crx dist/browserpass-chromeos-github-$(VERSION).crx

	for file in dist/*; do \
	    gpg --detach-sign --armor "$$file"; \
	done

	mkdir -p dist-webstore

	cp -a chromium dist-webstore/
	sed -i '/"key"/d' dist-webstore/chromium/manifest.json
	(cd dist-webstore/chromium && zip -r ../chrome-$(VERSION).zip *)
	rm -rf dist-webstore/chromium
