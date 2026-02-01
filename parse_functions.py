#!/usr/bin/env python3
import re
import json

def parse_functions(file_path):
    functions = []

    with open(file_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    # Patterns for different function types
    patterns = [
        # Regular function: function name(params)
        (r'^\s*function\s+(\w+)\s*\((.*?)\)', 'function', False),
        # Async function: async function name(params)
        (r'^\s*async\s+function\s+(\w+)\s*\((.*?)\)', 'function', True),
        # Arrow function: const/let/var name = (params) =>
        (r'^\s*(?:const|let|var)\s+(\w+)\s*=\s*\((.*?)\)\s*=>', 'arrow', False),
        # Async arrow function: const/let/var name = async (params) =>
        (r'^\s*(?:const|let|var)\s+(\w+)\s*=\s*async\s*\((.*?)\)\s*=>', 'arrow', True),
        # Method in object: name: function(params)
        (r'^\s*(\w+)\s*:\s*function\s*\((.*?)\)', 'function', False),
        # Async method in object: name: async function(params)
        (r'^\s*(\w+)\s*:\s*async\s+function\s*\((.*?)\)', 'function', True),
    ]

    for line_num, line in enumerate(lines, 1):
        # Look for comment above function (within 3 lines)
        description = ""
        for i in range(1, 4):
            if line_num - i > 0:
                prev_line = lines[line_num - i - 1].strip()
                if prev_line.startswith('//'):
                    description = prev_line.lstrip('/').strip()
                    break
                elif prev_line.startswith('/*') or '*/' in prev_line:
                    description = prev_line.replace('/*', '').replace('*/', '').replace('*', '').strip()
                    break

        # Try each pattern
        for pattern, func_type, is_async in patterns:
            match = re.match(pattern, line)
            if match:
                name = match.group(1)
                params_str = match.group(2).strip()

                # Parse parameters
                params = []
                if params_str:
                    # Split by comma, but handle nested structures
                    params = [p.strip() for p in params_str.split(',') if p.strip()]

                # Skip stub functions
                if '// Stub' in line or '{}' in line and len(line.strip()) < 100:
                    if not description:
                        description = "Stub function"

                functions.append({
                    "name": name,
                    "line": line_num,
                    "parameters": params,
                    "async": is_async,
                    "description": description if description else "",
                    "type": func_type
                })
                break

    return functions

if __name__ == "__main__":
    file_path = "/home/user/taxi-App/index.html"
    output_path = "/home/user/taxi-App/functions-index.json"

    print(f"Scanning {file_path}...")
    functions = parse_functions(file_path)

    result = {
        "total_functions": len(functions),
        "file": file_path,
        "functions": functions
    }

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print(f"Found {len(functions)} functions")
    print(f"Saved to {output_path}")

    # Print summary
    async_count = sum(1 for f in functions if f['async'])
    arrow_count = sum(1 for f in functions if f['type'] == 'arrow')
    regular_count = len(functions) - arrow_count

    print(f"\nSummary:")
    print(f"  Total: {len(functions)}")
    print(f"  Async: {async_count}")
    print(f"  Arrow functions: {arrow_count}")
    print(f"  Regular functions: {regular_count}")
