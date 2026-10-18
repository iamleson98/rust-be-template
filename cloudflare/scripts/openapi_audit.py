#!/usr/bin/env python3
"""Dump resolved response schemas from openapi.json for API contract audit."""
import json
import sys

spec = json.load(open('/home/z/my-project/repo/frontend/openapi.json'))
schemas = spec.get('components', {}).get('schemas', {})

RESOLVED = {}

def resolve(node, depth=0):
    if depth > 12:
        return '<max-depth>'
    if isinstance(node, dict):
        if '$ref' in node:
            name = node['$ref'].split('/')[-1]
            if name not in RESOLVED:
                if depth > 3:
                    RESOLVED[name] = None  # placeholder to cut recursion
                RESOLVED[name] = resolve(schemas.get(name, {}), depth + 1)
                return f'@{name}'
            return f'@{name}'
        out = {}
        for k, v in node.items():
            if k in ('description', 'example', 'examples', 'xml', 'x-order'):
                continue
            out[k] = resolve(v, depth + 1)
        return out
    if isinstance(node, list):
        return [resolve(v, depth + 1) for v in node]
    return node

def schema_summary(node, indent=0):
    """Compact summary: object → {field:type}, array → [item]"""
    pad = '  ' * indent
    if isinstance(node, dict):
        if '$ref' in str(node.get('$ref', '')) or (isinstance(node, dict) and '$ref' in node):
            return node['$ref']
        t = node.get('type')
        if t == 'object':
            props = node.get('properties', {})
            req = set(node.get('required', []))
            lines = ['{']
            for k, v in props.items():
                mark = '' if k in req else '?'
                lines.append(f'{pad}  {k}{mark}: {schema_summary(v, indent + 1)}')
            lines.append(pad + '}')
            return '\n'.join(lines)
        if t == 'array':
            return f'[{schema_summary(node.get("items", {}), indent)}]'
        if 'enum' in node:
            return f'{t or "enum"}: {"|".join(map(str, node["enum"]))[:60]}'
        return str(t or node.get('format', '?'))
    return str(node)

def endpoint_schema(path, method='get'):
    item = spec['paths'].get(path, {})
    op = item.get(method)
    if not op:
        return None
    resp = op.get('responses', {}).get('200', {})
    content = resp.get('content', {}).get('application/json', {})
    return content.get('schema')

if __name__ == '__main__':
    args = sys.argv[1:]
    if args and args[0] == '--list-refs':
        # Show top-level refs used by endpoints
        for path in sorted(spec['paths'].keys()):
            for m in ('get', 'post', 'put', 'patch', 'delete'):
                s = endpoint_schema(path, m)
                if s and '$ref' in s:
                    print(f'{m.upper():6} {path:55} {s["$ref"].split("/")[-1]}')
                elif s:
                    print(f'{m.upper():6} {path:55} (inline)')
    else:
        # Dump resolved schema for given names or path+method
        for target in args:
            if target.startswith('/'):
                method = 'get'
                if ':' in target:
                    p, method = target.split(':', 1)
                else:
                    p = target
                s = endpoint_schema(p, method)
                if s is None:
                    print(f'-- {method.upper()} {p}: NOT FOUND')
                    continue
                print(f'-- {method.upper()} {p}')
                r = resolve(s)
                print(schema_summary(r))
            else:
                if target not in schemas:
                    print(f'-- schema {target}: NOT FOUND')
                    continue
                print(f'-- schema {target}')
                print(schema_summary(resolve(schemas[target])))
            print()
