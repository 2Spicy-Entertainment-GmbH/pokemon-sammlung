# Pokémon-Sammlung

Eine kleine Web-App, um unsere Pokémon-Karten zu verwalten: Was haben wir, wem gehört welche Karte, was ist sie wert, und wie finden wir sie?

## Starten

Einfach `index.html` im Browser öffnen. Es gibt keinen Build-Schritt und keinen Server. Für die Kartensuche und die Preise braucht man Internet.

Zum Hosten (z. B. GitHub Pages, Netlify) reicht es, den Ordner `pokemon-sammlung/` hochzuladen.

## Funktionen

- **Karten suchen** mit deutschen oder englischen Namen (z. B. „Glurak“), optional mit Kartennummer
- **Zur Sammlung hinzufügen** mit Besitzer, Anzahl, Zustand (MT … PO), Variante (Normal/Reverse/Holo/1. Edition), Kartensprache, Grading (PSA …), Kaufpreis, eigenem Wert, Notiz und Favorit
- **Bewerten**: eigene 1–5-Sterne-Bewertung und Marktwert (Cardmarket-Trendpreis in EUR, je nach Variante)
- **Mehrere Sammler**: jedes Familienmitglied mit eigener Farbe, filterbar
- **Wunschliste** für Karten, die noch fehlen
- **Statistik**: Gesamtwert, Gewinn/Verlust gegenüber dem Kaufpreis, wertvollste Karten, Wert pro Sammler, Sets, Seltenheiten, Typen
- **Preise aktualisieren** auf Knopfdruck
- **Foto-Scan**: Karten per Foto erkennen lassen, auch viele auf einmal (siehe unten)
- **Mehrere Karten auf einmal** (Karten suchen → „Mehrere Karten auf einmal eintragen“): Liste mit Karten-IDs einfügen, die App holt Bilder und Preise selbst
- **Manuell eintragen**, falls eine Karte nicht in der Datenbank steht
- **Export/Import** als JSON (Sicherung oder Umzug auf ein anderes Gerät) und als CSV (für Excel)

## Foto-Scan

Im Tab **Foto-Scan** erkennt Claude die Karten auf euren Fotos, auch viele Karten auf einem Foto.

1. Einmalig einen Claude-API-Schlüssel eintragen. Den bekommt ihr auf [console.anthropic.com](https://console.anthropic.com/) unter *API Keys*, vorher etwas Guthaben aufladen. Der Schlüssel wird nur im Browser des jeweiligen Geräts gespeichert und direkt an Claude geschickt.
2. **Foto aufnehmen** (Kamera) oder **Fotos auswählen** (beliebig viele aus der Galerie).
3. Die App zeigt alle erkannten Karten mit Bild, Set, Nummer und Cardmarket-Preis. Gleiche Karten werden zusammengezählt, auch über mehrere Fotos hinweg.
4. Bei Bedarf Anzahl, Variante oder die genaue Karte korrigieren. Unsichere Treffer sind mit „bitte prüfen“ markiert.
5. Besitzer und Zustand wählen, dann **Zur Sammlung hinzufügen**. Karten, die schon in der Sammlung sind, werden aufgestockt statt doppelt angelegt.

Tipps: Karten auf einen ruhigen Untergrund legen, keine Spiegelungen, Name und Nummer unten auf der Karte lesbar. Ein Foto kostet etwa 2–5 Cent.

Doppelte Karten findet ihr in der Sammlung mit dem Filter **nur doppelte**.

## Mehrere Karten per Liste

Unter *Karten suchen → Mehrere Karten auf einmal eintragen* kann man auch eine Liste einfügen. Eine Zeile pro Karte: `Karten-ID Anzahl [Variante] [Zustand] [en|de]`, z. B. `swsh3-20 1 holo`. Varianten: `holo`, `reverse`, `1st`. Zustände: `MT NM EX GD LP PL PO`.

## Daten

- Kartendaten, Bilder und Preise kommen von der freien [TCGdex-API](https://tcgdex.dev). Die Preise stammen von Cardmarket. Einen API-Schlüssel braucht man dafür nicht.
- Die Sammlung wird im `localStorage` des jeweiligen Browsers gespeichert. Deshalb regelmäßig über *Einstellungen → Sicherung exportieren* sichern.
