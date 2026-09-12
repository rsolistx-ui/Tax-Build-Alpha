with open('C:\\Tax Build Alpha\\apps\\api\\src\\routes\\tax-adjustment.ts', 'rb') as f:
    content = f.read()

# Find the corruption
idx = content.find(b'isTaxOnly ?? false')
if idx >= 0:
    print(f'Found at byte offset: {idx}')
    # Check the byte before 'false'
    if idx > 0 and content[idx-1] == 0x3F:  # '?'
        print(f'Found extra ? at {idx-1}, removing...')
        new_content = content[:idx-1] + content[idx:]
        with open('C:\\Tax Build Alpha\\apps\\api\\src\\routes\\tax-adjustment.ts', 'wb') as f:
            f.write(new_content)
        print('Fixed: removed extra ?')
    else:
        print('No extra ? found before false')
else:
    print('Pattern not found')