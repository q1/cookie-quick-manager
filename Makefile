mk_sources: clean
	npm run build
	@echo "sources ready"

build: mk_sources

package: clean
	npm run package

clean:
	@rm -rf build/
	@echo "clean done"

get_missing_DE_translations:
	@diff src/_locales/de/messages.json src/_locales/en/messages.json | grep ": {"; [ $$? -eq 1 ]

get_missing_FR_translations:
	@diff src/_locales/fr/messages.json src/_locales/en/messages.json | grep ": {"; [ $$? -eq 1 ]

get_missing_from_new_language:
	mkdir -p src/_locales/$(LOCALE)
	@touch src/_locales/$(LOCALE)/messages.json
	@echo "\"src/_locales/$(LOCALE)/messages.json\" is created!"
	@diff src/_locales/$(LOCALE)/messages.json src/_locales/en/messages.json | grep ": {"; [ $$? -eq 1 ]