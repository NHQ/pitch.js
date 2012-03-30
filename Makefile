TESTDIR := ./tests
PORT_TARGET := $(TESTDIR)/port/test.js
REF_TARGET := $(TESTDIR)/ref/ref.out
PORT_SOURCE := src/pitch.js $(TESTDIR)/tools/wavreader.js
REF_SOURCE := $(TESTDIR)/ref/*.cc

COMPARE := $(TESTDIR)/tools/compare.js
CXX := g++

CXX_FLAGS := -Wall -lm -lsndfile

all:
	@for i in *.wav; do make $${i:0:-4}.test; done

$(REF_TARGET): $(REF_SOURCE)
	$(CXX) $(CXX_FLAGS) $^ -o $@

$(PORT_TARGET): $(PORT_SOURCE)
	touch $@ # Nasty, but saves time

%.test: %.ref.data %.port.data
	$(COMPARE) $^ > $@

%.ref.data: $(REF_TARGET) %.wav
	$^ $@

%.port.data: $(PORT_TARGET) %.wav
	$^ $@

clean:
	rm -rf $(REF_TARGET) *.data */*.data */*/*.data *.test */*.test */*/*.test

.PHONY: all clean
