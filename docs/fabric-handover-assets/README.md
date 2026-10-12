# Fabric handover diagrams

The editable system overview is SVG artwork. The four lifecycle diagrams have
editable Mermaid sources (`.mmd`) and rendered SVGs. All five SVGs are embedded
by `../fabric-handover.md`; SVG keeps the diagrams crisp when resized in Word.

To regenerate the SVGs from the repository root with Node.js and npx available:

```powershell
npx --yes --package @mermaid-js/mermaid-cli mmdc -i docs/fabric-handover-assets/identity-lifecycle.mmd -o docs/fabric-handover-assets/identity-lifecycle.svg -b white
npx --yes --package @mermaid-js/mermaid-cli mmdc -i docs/fabric-handover-assets/listing-lifecycle.mmd -o docs/fabric-handover-assets/listing-lifecycle.svg -b white
npx --yes --package @mermaid-js/mermaid-cli mmdc -i docs/fabric-handover-assets/wallet-lifecycle.mmd -o docs/fabric-handover-assets/wallet-lifecycle.svg -b white
npx --yes --package @mermaid-js/mermaid-cli mmdc -i docs/fabric-handover-assets/purchase-settlement.mmd -o docs/fabric-handover-assets/purchase-settlement.svg -b white
```

The command uses Mermaid CLI temporarily; it does not add a project dependency.
