AJV := node_modules/.bin/ajv
BROWSERIFY := node_modules/.bin/browserify
PRETTIER := node_modules/.bin/prettier

CLEAN_FILES := dist
PRETTIER_FILES := $(wildcard *.json *.js *.html options/*.js options/*.html make-persistent/*.js make-persistent/*.html)

.PHONY: all
all: deps prettier dist/request.dist.js

.PHONY: deps
deps:
	yarn install

.PHONY: prettier
prettier: $(PRETTIER) $(PRETTIER_FILES)
	$(PRETTIER) --write $(PRETTIER_FILES)

dist/request.dist.js: $(AJV) $(BROWSERIFY) request.schema.json
	[ -d dist ] || mkdir -p dist
	$(AJV) compile -s request.schema.json -o dist/request.js
	$(BROWSERIFY) -o dist/request.dist.js --standalone requestValidator dist/request.js

.PHONY: clean
clean:
	rm -rf $(CLEAN_FILES)
