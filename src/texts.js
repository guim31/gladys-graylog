// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the "Test the connection" report, scene action
// messages. Four languages, the four of the Gladys interface; German says
// "du", Spanish "usted". test/i18n.test.js checks every table.
//
// The input states (RUNNING, FAILED…) and the storage health (green, yellow,
// red) stay the words of Graylog: its interface does not translate them.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './graylog/client.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noServer: {
    en: 'Enter the address of your Graylog and an access token in the configuration.',
    fr: "Saisissez l'adresse de votre Graylog et un jeton d'accès dans la configuration.",
    de: 'Gib die Adresse deines Graylog und ein Zugriffstoken in der Konfiguration ein.',
    es: 'Introduzca la dirección de su Graylog y un token de acceso en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. 192.168.1.2 or http://graylog.lan:9000',
    fr: 'Adresse incomprise, ex. 192.168.1.2 ou http://graylog.lan:9000',
    de: 'Adresse nicht verstanden, z. B. 192.168.1.2 oder http://graylog.lan:9000',
    es: 'Dirección no válida, p. ej. 192.168.1.2 o http://graylog.lan:9000',
  },
};

// One short explanation per error kind (src/graylog/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'Graylog does not answer',
    fr: 'Graylog ne répond pas',
    de: 'Graylog antwortet nicht',
    es: 'Graylog no responde',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: tick "Accept self-signed certificates"',
    fr: 'certificat refusé : cochez « Accepter les certificats auto-signés »',
    de: 'Zertifikat abgelehnt: Aktiviere „Selbstsignierte Zertifikate akzeptieren“',
    es: 'certificado rechazado: marque «Aceptar certificados autofirmados»',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'access token, user or password refused',
    fr: "jeton d'accès, utilisateur ou mot de passe refusé",
    de: 'Zugriffstoken, Benutzer oder Passwort abgelehnt',
    es: 'token de acceso, usuario o contraseña rechazados',
  },
  [ERROR_KINDS.CREDENTIALS_MISSING]: {
    en: 'an access token (or a user and its password) is needed',
    fr: "un jeton d'accès (ou un utilisateur et son mot de passe) est nécessaire",
    de: 'ein Zugriffstoken (oder ein Benutzer und sein Passwort) ist nötig',
    es: 'se necesita un token de acceso (o un usuario y su contraseña)',
  },
  [ERROR_KINDS.NOT_GRAYLOG]: {
    en: 'no Graylog API at this address: check the port (9000)',
    fr: "pas d'API Graylog à cette adresse : vérifiez le port (9000)",
    de: 'keine Graylog-API unter dieser Adresse: Prüfe den Port (9000)',
    es: 'no hay ninguna API de Graylog en esta dirección: compruebe el puerto (9000)',
  },
  [ERROR_KINDS.PERMISSION]: {
    en: 'permission missing for this user, see the documentation',
    fr: 'permission manquante pour cet utilisateur, voir la documentation',
    de: 'Berechtigung dieses Benutzers fehlt, sieh in der Dokumentation nach',
    es: 'falta un permiso de este usuario, consulte la documentación',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    ok: 'OK',
    rate: (value) => `${value} msg/s`,
    inputs: (failed, total) => `${failed}/${total} input(s) failed`,
    definitions: (count) => `${count} event definition(s)`,
    alerts: (count) => `${count} alert(s) in 24 h`,
  },
  fr: {
    ok: 'OK',
    rate: (value) => `${value} msg/s`,
    inputs: (failed, total) => `${failed}/${total} entrée(s) en échec`,
    definitions: (count) => `${count} définition(s) d'événement`,
    alerts: (count) => `${count} alerte(s) en 24 h`,
  },
  de: {
    ok: 'OK',
    rate: (value) => `${value} Nachr./s`,
    inputs: (failed, total) => `${failed}/${total} Input(s) fehlerhaft`,
    definitions: (count) => `${count} Ereignisdefinition(en)`,
    alerts: (count) => `${count} Alarm(e) in 24 h`,
  },
  es: {
    ok: 'OK',
    rate: (value) => `${value} msj/s`,
    inputs: (failed, total) => `${failed}/${total} entrada(s) con fallo`,
    definitions: (count) => `${count} definición(es) de evento`,
    alerts: (count) => `${count} alerta(s) en 24 h`,
  },
};

// Scene action messages (shown in Gladys).
export const ACTION_TEXT = {
  noServer: {
    en: 'No Graylog is configured.',
    fr: "Aucun Graylog n'est configuré.",
    de: 'Kein Graylog ist konfiguriert.',
    es: 'No hay ningún Graylog configurado.',
  },
  unknownDefinition: {
    en: 'This device is not a Graylog event definition.',
    fr: "Cet appareil n'est pas une définition d'événement Graylog.",
    de: 'Dieses Gerät ist keine Graylog-Ereignisdefinition.',
    es: 'Este dispositivo no es una definición de evento de Graylog.',
  },
  none: {
    en: 'No alert in the last 24 hours.',
    fr: 'Aucune alerte ces dernières 24 heures.',
    de: 'Kein Alarm in den letzten 24 Stunden.',
    es: 'Ninguna alerta en las últimas 24 horas.',
  },
  noEvent: {
    en: 'No event in the last 24 hours.',
    fr: 'Aucun événement ces dernières 24 heures.',
    de: 'Kein Ereignis in den letzten 24 Stunden.',
    es: 'Ningún evento en las últimas 24 horas.',
  },
};

export const LANGUAGE_FALLBACK = 'en';

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;
export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];
