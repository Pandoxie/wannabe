package main

import (
	"slices"
	"strings"
	"testing"
)

func TestNumberArg(t *testing.T) {
	for _, c := range []struct {
		args  []string
		name  string
		given bool
		rest  []string
	}{
		{nil, "1", false, nil},
		{[]string{"2"}, "2", true, []string{}},
		{[]string{"status"}, "1", false, []string{"status"}},
		// Only right after the command: a value 2 stays a value.
		{[]string{"set", "access.resources.cpus", "2"}, "1", false, []string{"set", "access.resources.cpus", "2"}},
		{[]string{"3", "set", "access.resources.cpus", "2"}, "3", true, []string{"set", "access.resources.cpus", "2"}},
		{[]string{"2", "--", "ls", "-l"}, "2", true, []string{"--", "ls", "-l"}},
		// After --, a --name is the command's own argument.
		{[]string{"--", "tool", "--name", "x"}, "1", false, []string{"--", "tool", "--name", "x"}},
	} {
		name, given, rest, err := numberArg(c.args)
		if err != nil || name != c.name || given != c.given || !slices.Equal(rest, c.rest) {
			t.Errorf("%q: %q %v %q %v", c.args, name, given, rest, err)
		}
	}
	for _, bad := range [][]string{{"0"}, {"01"}, {"12345"}, {"--name", "2"}, {"--name=default"}, {"2", "--name", "3"}} {
		if _, _, _, err := numberArg(bad); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
}

func TestLoadInternalTakesTheOlderName(t *testing.T) {
	t.Setenv("HSB_HOME", t.TempDir())
	// Neither exists; the error names the sandbox it looked for.
	if _, err := loadInternal([]string{"--name", "default"}); err == nil || !contains(err.Error(), `"default"`) {
		t.Fatalf("--name default: %v", err)
	}
	if _, err := loadInternal([]string{"2"}); err == nil || !contains(err.Error(), `"2"`) {
		t.Fatalf("2: %v", err)
	}
}

func contains(s, sub string) bool { return strings.Contains(s, sub) }
