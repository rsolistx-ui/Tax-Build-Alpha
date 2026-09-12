with open('C:\\Tax Build Alpha\\apps\\api\\src\\routes\\tax-adjustment.ts', 'r') as f:
    content = f.read()

# Delete the problematic function entirely
idx = content.find('taxAdjustmentRoutes.post("/:clientId/tax-adjustments/:journalId/lines"')
if idx >= 0:
    end_idx = content.find('// Post tax adjustment journal', idx)
    if end_idx >= 0:
        print(f'Deleting from {idx} to {end_idx}')
        new_content = content[:idx] + content[end_idx:]
        with open('C:\\Tax Build Alpha\\apps\\api\\src\\routes\\tax-adjustment.ts', 'w') as f:
            f.write(new_content)
        print('Deleted problematic function')
    else:
        print('Could not find end')
else:
    print('Could not find function start')