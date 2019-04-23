BROWSERIFY := node_modules/.bin/browserify
PRETTIER := node_modules/.bin/prettier
LESSC := node_modules/.bin/lessc

CLEAN_FILES := js
PRETTIER_FILES := $(wildcard *.json *.js options/*.js options/*.html)

.PHONY: all
all: deps prettier js/background.dist.js js/options.dist.js

.PHONY: deps
deps:
	yarn install

.PHONY: prettier
prettier: $(PRETTIER) $(PRETTIER_FILES)
	$(PRETTIER) --write $(PRETTIER_FILES)

js/background.dist.js: $(BROWSERIFY) background.js errors.js
	[ -d js ] || mkdir -p js
	$(BROWSERIFY) -o js/background.dist.js -t [ babelify --presets [ @babel/preset-env ] ] background.js

js/options.dist.js: $(BROWSERIFY) options/*.js
	[ -d js ] || mkdir -p js
	$(BROWSERIFY) -o js/options.dist.js -t [ babelify --presets [ @babel/preset-env ] ] options/options.js

.PHONY: clean
clean:
	rm -rf $(CLEAN_FILES)
