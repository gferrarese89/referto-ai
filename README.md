# 🩻 RefertoAI

Web app di refertazione radiologica assistita da AI: scrivi (o detti col microfono di sistema) i **reperti** di un esame, e l'app genera il **referto completo in italiano, nel tuo stile personale**, pronto da copiare nel RIS — più un pannello separato con **diagnosi differenziali** e suggerimenti.

Supporta: **ecografia, RX, TC, RM, mammografia**.

## Come funziona

- È una pagina web statica: **niente da installare**, funziona da qualsiasi browser (PC di lavoro bloccati dall'IT compresi) e da iPhone.
- Il browser chiama **direttamente** l'API di Claude (Anthropic): i dati clinici viaggiano solo tra il tuo browser e Anthropic, nessun altro server.
- Al primo avvio un **wizard** ti chiede di incollare alcuni tuoi referti: l'app ne estrae il tuo stile di refertazione e lo imita in ogni referto generato.
- Tutto (stile, esempi, impostazioni, chiave API) resta salvato **solo nel tuo browser**. Puoi esportare/importare il profilo per portarlo su altri dispositivi.

## Requisiti

1. **Chiave API Anthropic**: vai su [console.anthropic.com](https://console.anthropic.com), crea un account, aggiungi un metodo di pagamento e in *API Keys* crea una chiave (`sk-ant-...`).
   💡 Consigliato: in *Settings → Limits* imposta un limite di spesa mensile (es. 20 $). Un referto costa indicativamente pochi centesimi.
2. Un browser moderno (Chrome, Edge, Safari, Firefox).

## Avvio in locale (per provarla subito)

```bash
cd "Reporting software"
python3 -m http.server 8000
```

Apri [http://localhost:8000](http://localhost:8000).

> Nota: aprire `index.html` con doppio click (protocollo `file://`) non funziona per i moduli JavaScript — serve un server, anche minimale come sopra.

## Pubblicazione su GitHub Pages (per usarla ovunque)

1. Crea un account su [github.com](https://github.com) (gratuito).
2. Crea un repository, es. `referto-ai` (pubblico; il codice non contiene dati clinici né chiavi).
3. Carica tutti i file di questa cartella nel repository.
4. Nel repository: *Settings → Pages → Source: Deploy from a branch → Branch: main / (root)* → Save.
5. Dopo ~1 minuto l'app è su `https://<tuo-utente>.github.io/referto-ai/` — apribile da qualsiasi PC o telefono.

Con `git` e `gh` da terminale:

```bash
git init && git add -A && git commit -m "RefertoAI"
gh repo create referto-ai --public --source . --push
gh api repos/{owner}/referto-ai/pages -X POST -f 'source[branch]=main' -f 'source[path]=/'
```

## Installazione su iPhone

1. Apri l'URL dell'app in **Safari**.
2. Tocca **Condividi → Aggiungi a schermata Home**.
3. L'app appare come icona e si apre a schermo intero.

## Uso quotidiano

1. (Opzionale) Seleziona modalità e distretto — oppure lascia **Auto-rileva**.
2. Scrivi i reperti patologici (es. *"lesione focale epatica al VI segmento di 2 cm, ipervascolare con washout. Resto negativo."*). Puoi dettare col microfono di sistema: **Win+H** su Windows, **🎤 della tastiera** su iPhone — l'AI corregge i termini medici stravolti dalla dettatura.
3. **✨ Genera referto** → il referto appare nell'editor nel tuo stile; le differenziali nel pannello sotto.
4. Correggi se serve → **📋 Copia referto** → incolla nel RIS.
5. Se hai corretto molto, **📚 Impara da questo** salva la versione corretta come esempio: i prossimi referti saranno più fedeli al tuo stile.

## Caricare i tuoi referti nel wizard

Nel wizard puoi incollare i referti **senza limiti di quantità**, oppure caricare file **`.txt`, `.docx` o `.doc`** con dentro tutti i referti misti (il testo estratto appare nel campo, così puoi controllarlo e ripulirlo). Con corpora grandi l'analisi avviene a blocchi con una barra di avanzamento, e prima di partire l'app ti mostra una **stima del costo** una tantum sulla tua chiave API. Tutti i referti analizzati finiscono nel tuo **archivio locale**: a ogni generazione l'app pesca automaticamente i tuoi referti più pertinenti (stessa modalità e distretto) come esempi.

> Nota: il modello AI non viene "addestrato" in senso tecnico — il tuo stile e i tuoi esempi vengono forniti al modello a ogni richiesta (apprendimento in contesto). Il risultato pratico è lo stesso: referti nel tuo stile, che migliorano man mano che arricchisci l'archivio.

## Sincronizzazione tra dispositivi (Mac ↔ iPhone ↔ PC lavoro)

Attivabile in *Impostazioni → Sincronizzazione*: il profilo di stile e l'archivio referti si sincronizzano automaticamente tramite un **Gist segreto** del tuo account GitHub (gratuito). Così "Impara da questo" fatto sul Mac si ritrova su iPhone il giorno dopo.

1. Crea un token su [github.com/settings/tokens/new](https://github.com/settings/tokens/new) (token *classic*), selezionando **solo** lo scope `gist`.
2. Incollalo in *Impostazioni → Sincronizzazione* su ogni dispositivo: tutti si agganciano allo stesso profilo.
3. La sync avviene all'apertura dell'app e dopo ogni modifica; c'è anche "Sincronizza ora".

La chiave API di Claude e il token GitHub **non vengono mai sincronizzati** (restano solo sul dispositivo). In alternativa resta l'export/import manuale su file (*Impostazioni → Portabilità manuale*).

## Portare il profilo su un altro dispositivo (manuale)

*Impostazioni → Esporta profilo* → salvi un file `.json` (senza chiavi) → sull'altro dispositivo *Impostazioni → Importa profilo*. Il file può viaggiare su chiavetta, AirDrop o email.

## FAQ — Sicurezza

**La mia chiave API finisce su GitHub?** No. Su GitHub c'è solo il codice dell'app (pubblico, senza segreti). La chiave la incolli nell'app in esecuzione **nel tuo browser** e resta salvata solo lì; viene inviata esclusivamente ad api.anthropic.com. GitHub non la vede mai.

**Cosa succede se qualcuno usa il PC dopo di me?** Sui PC condivisi deseleziona "Ricorda su questo dispositivo": chiave e token vivono solo per la sessione e spariscono alla chiusura del browser.

**E se qualcuno rubasse la chiave?** Potrebbe solo consumare credito API a tue spese, fino al limite di spesa che hai impostato in console Anthropic (per questo è importante impostarlo). Da lì la revochi e ne crei una nuova in 30 secondi.

**I referti sincronizzati su GitHub sono visibili?** Il Gist è *segreto*: non compare nei motori di ricerca né nel tuo profilo pubblico, ed è accessibile solo con il tuo account/token. Contiene comunque i tuoi referti-esempio: per questo vanno **sempre anonimizzati** prima di darli al wizard.

## Privacy e sicurezza

- ⚠️ **Non inserire mai dati identificativi del paziente** (nome, data di nascita, ID cartella) nei reperti o nei referti incollati nel wizard.
- I dati inviati all'API Anthropic non vengono usati per addestrare i modelli (vedi [privacy Anthropic](https://www.anthropic.com/legal/privacy)).
- Sui **PC condivisi**, deseleziona "Ricorda la chiave su questo dispositivo": la chiave sarà chiesta a ogni sessione e sparirà alla chiusura del browser.
- L'app non salva referti né reperti su disco; gli unici dati persistiti sono il profilo di stile e gli esempi che salvi esplicitamente.
- ⚕️ Il referto generato è una **bozza**: la responsabilità clinica del contenuto resta del medico refertante. Rileggi sempre prima di firmare.

## Licenza

© 2026 Goffredo Ferrarese — **Tutti i diritti riservati.** È consentito solo l'uso personale tramite il sito ufficiale; sono vietate copia, modifica, ripubblicazione e uso commerciale senza autorizzazione scritta. Vedi il file [LICENSE](LICENSE).

## Roadmap (fasi successive)

- 🎙 Dettatura integrata con lessico medico (Whisper eseguito nel browser via WebAssembly — nessuna installazione)
- Confronto con referto precedente
- Cronologia referti locale
