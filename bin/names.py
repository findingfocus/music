#!/usr/bin/env python3
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def load_table():
    with open(os.path.join(HERE, "names.json")) as f:
        return json.load(f)


def get(index):
    table = load_table()
    n = ((index - 1) % table["total"]) + 1
    return table["names"][n - 1]


if __name__ == "__main__":
    index = int(sys.argv[1])
    row = get(index)
    print(row["title"])