BROWSERIFY := node_modules/.bin/browserify
PRETTIER := node_modules/.bin/prettier
LESSC := node_modules/.bin/lessc

CLEAN_FILES := js
PRETTIER_FILES := $(wildcard *.json *.js)

.PHONY: all
all: deps prettier js/background.dist.js

.PHONY: deps
deps:
	yarn install

.PHONY: prettier
prettier: $(PRETTIER) $(PRETTIER_FILES)
	$(PRETTIER) --write $(PRETTIER_FILES)

js/background.dist.js: $(BROWSERIFY) background.js
	[ -d js ] || mkdir -p js
	$(BROWSERIFY) -o js/background.dist.js background.js

.PHONY: clean
clean:
	rm -rf $(CLEAN_FILES)
