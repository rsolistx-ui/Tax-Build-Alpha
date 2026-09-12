with open('C:\\Tax Build Alpha\\apps\\api\\src\\routes\\tax-adjustment.ts', 'rb') as f:
    content = f.read()

# Fix double question marks
# 1. Fix exchange_rate line: "?? ?1" -> "?? 1"
content = content.replace(b'exchangeRate ?? ?1', b'exchangeRate ?? 1')

# 2. Fix is_tax_only line: "?? ?false" -> "?? false"
content = content.replace(b'isTaxOnly ?? ?false', b'isTaxOnly ?? false')

# Also check for any other double question marks
content = content.replace(b'?? ?', b'?? ')

with open('C:\\Tax Build Alpha\\apps\\api\\src\\routes\\tax-adjustment.ts', 'wb') as f:
    f.write(content)

print('Fixed double question marks')