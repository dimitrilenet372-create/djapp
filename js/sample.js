// Exemple pour essayer l'outil sans rien coller. Une ligne = « Artiste - Titre | genre | lien ».
export const SAMPLE_1 = `deadmau5 - Strobe | Progressive House | https://soundcloud.com/deadmau5/strobe
Eric Prydz - Opus | Progressive House
Swedish House Mafia - Don't You Worry Child | House
Fisher - Losing It | Tech House
Chris Lake - Turn Off The Lights | Tech House
Charlotte de Witte - Doppler | Techno
Amelie Lens - Hypnotized | Techno
Pendulum - Tarantula | Drum & Bass
Sub Focus - Rock It | Drum & Bass
Chase & Status - Blind Faith | Drum & Bass
Calibre - Even If | Drum & Bass
Skrillex - Scary Monsters and Nice Sprites | Dubstep
Excision - Throw That | Dubstep
Flume - Never Be Like You | Future Bass
M83 - Midnight City | Electronic
Kendrick Lamar - HUMBLE. | Hip-hop & Rap
Travis Scott - SICKO MODE | Hip-hop & Rap
Frank Ocean - Pyramids | R&B & Soul
Khruangbin - Maria También | Psychedelic
Tame Impala - The Less I Know The Better | Indie
Ludovico Einaudi - Nuvole Bianche | Piano`;

export const SAMPLE_2 = `deadmau5 - Strobe (Free Download) | Progressive House
deadmau5 - Strobe (Club Edit) | Progressive House
Midnight City (Eric Prydz Remix) | Electronic
M83 - Midnight City | Electronic
Fisher - Losing It (Original Mix) | Tech House
Charlotte De Witte - Doppler | Techno
Pendulum - Blood Sugar | Drum & Bass
Pendulum - Propane Nightmares | Drum & Bass
Noisia - Machine Gun | Drum & Bass
Rusko - Cockney Thug | Dubstep
Zeds Dead - Rude Boy | Dubstep
Illenium - Good Things Fall Apart | Future Bass
Kaytranada - Glowed Up | House
Daft Punk - One More Time | House
Daft Punk - Around the World | House
Disclosure - Latch | House
Four Tet - Baby | Electronic
Bonobo - Kerala | Electronic
Jamie xx - Gosh | Electronic
J. Cole - No Role Modelz | Hip-hop & Rap
Kendrick Lamar - Money Trees | Hip-hop & Rap
Tyler, The Creator - EARFQUAKE | Hip-hop & Rap
SZA - Good Days | R&B & Soul
Brent Faiyaz - Dead Man Walking | R&B & Soul`;

// Playlist d'exemple avec quelques doublons glissés dedans, pour montrer le nettoyage.
export const SAMPLE_A = `${SAMPLE_1}
Fisher - Losing It (Original Mix) | Tech House
deadmau5 - Strobe (Free Download) | Progressive House
Charlotte De Witte - Doppler | Techno`;
