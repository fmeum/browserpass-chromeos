PRETTIER := node_modules/.bin/prettier

CLEAN_FILES := js
PRETTIER_FILES := $(wildcard *.json *.js *.html options/*.js options/*.html)

.PHONY: all
all: deps prettier

.PHONY: deps
deps:
	yarn install

.PHONY: prettier
prettier: $(PRETTIER) $(PRETTIER_FILES)
	$(PRETTIER) --write $(PRETTIER_FILES)

.PHONY: clean
clean:
	rm -rf $(CLEAN_FILES)
