import re

with open('C:\\Tax Build Alpha\\apps\\api\\src\\routes\\tax-adjustment.ts', 'r') as f:
    content = f.read()

# Find the broken section and fix it
# The issue is around line 160-162 where the mapping ends abruptly

# Find the pattern
idx = content.find('currency: l.currency ?? "USD",')
if idx >= 0:
    # Find the end of the broken section (where "// Post tax adjustment journal" starts)
    next_section = content.find('// Post tax adjustment journal', idx)
    if next_section >= 0:
        # Replace the broken section with correct code
        replacement = '''currency: l.currency ?? "USD",
    exchange_rate: l.exchangeRate ?? 1,
    is_tax_only: l.isTaxOnly ?? false,
  })); 
  return c.json({ lines });
});

// Post tax adjustment journal'''
        new_content = content[:idx] + replacement + content[content.find('// Post tax adjustment journal'):]
        with open('C:\\Tax Build Alpha\\apps\\api\\src\\routes\\tax-adjustment.ts', 'w') as f:
            f.write(new_content)
        print('Fixed successfully')
    else:
        print('Could not find next section')
else:
    print('Pattern not found')