# Graylog

Hol deinen Logserver [Graylog](https://graylog.org/) in Gladys: Jede
Ereignisdefinition wird ein Gerät (ihre Ereignisse der letzten 24 Stunden, das
Datum des letzten), ein Gerät „Graylog“ überwacht den Server selbst
(Nachrichten pro Sekunde, fehlerhafte Inputs, Speicher rot, Rückstand im
Journal, Ereignisse und Alarme des Tages), und deine Szenen reagieren, wenn ein
Alarm ausgelöst wird: ein rotes Licht, wenn „Disk failure“ eintritt, eine
Nachricht, wenn ein Input keine Logs mehr empfängt oder OpenSearch rot wird.
Eine Szenen-Aktion liest die letzten Alarme für eine Nachricht, und ein
Dashboard-Widget zeigt sie an.

Die Integration liest die REST-API von Graylog (Port 9000) in deinem lokalen
Netzwerk, mit einem Zugriffstoken. Die Integration liest nur: In Graylog wird nichts
geändert. Nichts läuft über eine Cloud.

Getestet mit einem echten Graylog 6.1 (offizielles Docker-Image
`graylog/graylog:6.1`, MongoDB 6, OpenSearch 2.15): GELF- und Syslog-Inputs,
ein Input, der nicht startet, zwei Ereignisdefinitionen, gespeist von
GELF-Nachrichten, eine davon mit Benachrichtigung (ein Alarm), ein
Reader-Benutzer mit geteilten Streams. Graylog 5 hat dieselbe API, wurde aber
nicht getestet. Rückmeldungen willkommen:
[github.com/guim31/gladys-graylog/issues](https://github.com/guim31/gladys-graylog/issues).

## Was du brauchst

- Gladys Assistant 5.1.0 oder neuer.
- Graylog 6 (Open, Enterprise oder Security), vom Gladys-Rechner aus
  erreichbar, auf Port 9000 oder hinter einem Reverse Proxy.
- Einen Graylog-Benutzer für Gladys und sein Zugriffstoken. Vermeide das
  Konto `admin`: Die Integration muss nur lesen.

## Erste Schritte

### 1. Einen Benutzer für Gladys anlegen

In Graylog:

1. **System → Users and Teams → Create user**: ein Benutzer `gladys` mit der
   Rolle **Reader**.
2. Teile mit ihm, als **Viewer** (Schaltfläche **Share** jedes Elements):
   - jede zu verfolgende Ereignisdefinition (**Alerts → Event Definitions**);
   - den Stream **All events**, in dem die Ereignisse gespeichert werden;
   - die Streams, die diese Definitionen durchsuchen (oft **Default Stream**):
     Graylog zeigt ein Ereignis nur einem Benutzer, der die zugrunde liegenden
     Nachrichten lesen darf.
3. Beim Benutzer `gladys`: **Edit tokens**, ein Token `gladys` anlegen und
   kopieren (es wird nur einmal angezeigt).

Die Zustände der Inputs, der Durchsatz und der Zustand des Speichers brauchen
keine Freigabe. Geprüft mit Graylog 6.1: Mit der Rolle Reader allein werden die
Definitionen nicht aufgelistet und nur die Systembenachrichtigungen sind
sichtbar.

### 2. Die Integration konfigurieren

In Gladys, **Integrationen → Graylog → Konfiguration**:

- **Adresse**: die Adresse der Graylog-Weboberfläche, z. B. `192.168.1.2`
  (http:// und Port 9000 werden ergänzt), `graylog.lan:9000` oder
  `https://logs.example.org` hinter einem Reverse Proxy. Eine aus dem Browser
  kopierte Adresse geht auch.
- **Zugriffstoken**: das Token aus Schritt 1. Ohne Token fülle stattdessen
  **Benutzer (ohne Token)** und **Passwort (ohne Token)** aus.
- **Aktualisierungsintervall**: wie oft Graylog gelesen wird (standardmäßig
  1 Minute; jedes Mal fünf oder sechs API-Anfragen).
- **Selbstsignierte Zertifikate akzeptieren**: nur für eine `https://`-Adresse,
  deren Zertifikat dein System nicht kennt.
- **Sprache der Namen**: Sprache der Funktionsnamen (beim Hinzufügen eines
  Geräts festgelegt), der Daten und der Szenen-Ergebnisse.

Speichere, dann **Verbindung testen**: Die Antwort nennt die Graylog-Version,
die Nachrichten pro Sekunde, die fehlerhaften Inputs, die Anzahl der
Ereignisdefinitionen und die Alarme der letzten 24 Stunden.

### 3. Die Geräte hinzufügen

Lege im Tab **Entdecken** das Gerät „Graylog“ und die zu verfolgenden
Ereignisdefinitionen an. Nichts wird ohne dich angelegt. Die Auslöser, die
Szenen-Aktion und das Widget gelten für alle Definitionen, angelegt oder nicht.

## Die Geräte

**Graylog** (der Server oder der ganze Cluster):

| Funktion                       | Bedeutung                                                                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Nachrichten pro Sekunde        | Empfangene Nachrichten pro Sekunde, alle Nodes zusammen (das „In“ im Kopf von Graylog).                                                 |
| Fehlerhafte Inputs             | Inputs FAILED, FAILING oder falsch konfiguriert, auf irgendeinem Node. Ein absichtlich gestoppter Input zählt nicht.                    |
| Speicher rot                   | 1, wenn der OpenSearch-/Elasticsearch-Cluster rot ist (Nachrichten werden nicht mehr gespeichert). Gelb, üblich bei einem Node, gibt 0. |
| Wartende Nachrichten (Journal) | Ins Platten-Journal geschriebene, noch nicht verarbeitete Nachrichten: Eine wachsende Zahl heißt, Graylog kommt nicht hinterher.        |
| Ereignisse (24 h)              | Ereignisse der letzten 24 Stunden, alle Definitionen.                                                                                   |
| Alarme (24 h)                  | Die Alarme darunter (Ereignisse einer Definition mit Benachrichtigungen).                                                               |

**Ein Gerät pro Ereignisdefinition**:

| Funktion          | Bedeutung                                                                            |
| ----------------- | ------------------------------------------------------------------------------------ |
| Ereignisse (24 h) | Die Ereignisse der Definition in den letzten 24 Stunden.                             |
| Letztes Ereignis  | Datum und Uhrzeit des letzten Ereignisses, in der Zeitzone von Gladys (letzte 24 h). |

Das Gerät einer Definition trägt ihren Titel in Graylog. Die Definition
„System notification events“ (die Benachrichtigungen von Graylog selbst: ein
Input, der nicht startet, eine volle Platte, eine veraltete Version…) wird auch
angeboten.

## Dashboard

Das Widget **Graylog-Alarme** zeigt auf einen Blick:

- drei Zahlen: die Alarme der letzten 24 Stunden, die fehlerhaften Inputs und
  die Nachrichten pro Sekunde;
- die Probleme von Graylog selbst: jeden fehlerhaften Input, den Speicher, wenn
  er gelb oder rot ist;
- die letzten Alarme, der neueste zuerst, mit ihrer Uhrzeit.

Wähle in seinen Einstellungen die anzuzeigenden Ereignisdefinitionen (leer:
alle) und die **Zeilen**: **Nur Alarme** (Standard) oder **Alarme und
Ereignisse**. Die Schaltfläche **Aktualisieren** liest Graylog neu. Das Widget
funktioniert, bevor ein Gerät angelegt ist.

## Szenen

### Auslöser

- **Ein Graylog-Ereignis tritt ein**: ein neues Ereignis einer Definition.
  Filter: die Definitionen (leer: alle), die Art (**Alarm**: eine Definition
  mit Benachrichtigungen, **Ereignis**: ohne) und die Priorität. Variablen: die
  Definition, die Nachricht, die Art, die Priorität, die Quelle, der
  Ereignisschlüssel.
- **Ein Input fällt aus**: Ein Input wird FAILED, FAILING oder falsch
  konfiguriert; seine Nachrichten gehen verloren. Variablen: der Input, sein
  Typ, sein Zustand, der Fehler.
- **Ein Input läuft wieder**: Ein als ausgefallen gemeldeter Input ist wieder
  RUNNING. Variablen: der Input, sein Typ, die Dauer in Minuten.
- **Der Speicher wird rot**: Der OpenSearch-/Elasticsearch-Cluster von Graylog
  ist rot.
- **Der Speicher ist nicht mehr rot**: zurück auf Gelb oder Grün. Variablen:
  der Zustand, die Dauer in Minuten.
- **Graylog antwortet nicht mehr**: Die API hat zweimal hintereinander nicht
  geantwortet (etwa 15 Sekunden Abstand). Ein abgelehntes Token löst ihn nicht
  aus: Das sagt der Status der Integration.

Jedes Ereignis wird einmal gemeldet, auch nach einem Neustart von Gladys oder
der Integration (die schon gemeldeten Kennungen bleiben in `/data`). Die beim
Start der Integration schon vorhandenen Ereignisse werden nicht gemeldet.

### Aktion

**Letzte Alarme lesen** zählt und listet die Alarme der letzten 24 Stunden,
einer Definition oder aller; stelle **Was** auf **Alarme und Ereignisse**, um
die Ereignisse ohne Benachrichtigung einzuschließen. Ausgaben: die Anzahl, die
Definition und die Nachricht des letzten, vor wie vielen Minuten (-1, wenn
keiner), und eine Liste („Disk failure (14:32), …“, höchstens zehn).

### Szenen-Ideen

- **Ein Graylog-Ereignis tritt ein** (Definition „Disk failure“, Art Alarm) →
  das Bürolicht rot schalten und eine Nachricht „Graylog: {{message}}“ senden.
- **Ein Input fällt aus** → eine Nachricht senden: „Graylog empfängt
  {{input}} nicht mehr: {{message}}“. Dann **Ein Input läuft wieder** →
  „{{input}} ist nach {{duration_minutes}} min zurück“.
- Jeden Morgen um 8:00 → **Letzte Alarme lesen** → „{{count}} Alarm(e) in
  der Nacht: {{names}}“ senden.
- **Der Speicher wird rot** → alle benachrichtigen: Logs gehen verloren.

## Fehlerbehebung

- **„Zugriffstoken, Benutzer oder Passwort abgelehnt“**: Das Token wurde
  widerrufen oder falsch kopiert. Leg ein neues an (**Edit tokens**).
- **„keine Graylog-API unter dieser Adresse“**: Prüfe den Port (standardmäßig 9000) und den Pfad eines Reverse Proxy (`https://example.org/graylog`).
- **„Graylog antwortet nicht“**: Der Gladys-Rechner erreicht Graylog nicht
  (Firewall, Graylog gestoppt, ein Docker-Netzwerk). Probiere `curl
http://<Adresse>:9000/api/system/lbstatus` auf dem Gladys-Rechner.
- **„Zertifikat abgelehnt“**: Aktiviere **Selbstsignierte Zertifikate
  akzeptieren** oder nutze ein vertrauenswürdiges Zertifikat.
- **Keine Ereignisdefinition im Tab Entdecken, oder 0 Ereignisse, obwohl
  Graylog welche zeigt**: Der Benutzer sieht sie nicht. Teile mit ihm die
  Definitionen, den Stream **All events** und die durchsuchten Streams
  (Schritt 1).
- **„Berechtigung dieses Benutzers fehlt“**: Dem Benutzer fehlt eine
  Berechtigung auf den Systemseiten; die Rolle Reader deckt sie ab.
- Um zu sehen, was die Integration tut, setze `LOG_LEVEL=debug` auf ihrem
  Container.

## Grenzen

- Nur lesend: Die Integration ändert Graylog nicht und quittiert keine
  Ereignisse (Graylog Open hat keine Quittierung).
- Ein Ereignis wird beim nächsten Lesen gesehen (standardmäßig 1 Minute), und
  Graylog selbst führt eine Definition jede Minute oder seltener aus: Rechne mit
  bis zu einigen Minuten zwischen einer Logzeile und der Szene.
- Die 200 neuesten Ereignisse der letzten 24 Stunden werden pro Zyklus gelesen:
  Die Zähler bleiben darüber hinaus genau (Graylog zählt sie), aber eine Welle
  von mehr als 200 Ereignissen zwischen zwei Lesevorgängen meldet nur die
  neuesten 200. Höchstens 30 Szenen-Ereignisse gehen pro Lesevorgang raus; der
  Rest folgt bei den nächsten.
- Die Nachricht eines Ereignisses ist die, die Graylog schreibt: bei einer
  Aggregation (der üblichen Definition „Filter & Aggregation“) ihr Titel.
- Die Zustände der Inputs und des Speichers kommen über die API von Graylog
  selbst: Ein Benutzer ohne die Rolle Reader sieht dort nichts.
- Graylog 5 sollte funktionieren (dieselbe API), wurde aber nicht getestet.
