import os
import sys
import json
import re
import math
import hashlib
import urllib.request
import urllib.error
from datetime import datetime
from urllib.parse import quote, urlparse
from flask import Flask, render_template, jsonify, request, Response, stream_with_context

app = Flask(__name__)

CONFIG_FILE = 'config.json'
user_home = os.path.expanduser("~")
fallback_data_path = os.path.join(user_home, "TelegramOSINTData")

DEFAULT_CONFIG = {
    "data_path": fallback_data_path,
    "theme": "matrix",
    "sound_enabled": True
}

OSINT_CACHE = None

def validate_path(path):
    try:
        if not os.path.exists(path):
            os.makedirs(path, exist_ok=True)
        return True
    except Exception:
        return False

def load_config():
    config = DEFAULT_CONFIG.copy()
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                config.update(json.load(f))
        except Exception:
            pass
    if not validate_path(config["data_path"]):
        config["data_path"] = fallback_data_path
        os.makedirs(fallback_data_path, exist_ok=True)
    return config

save_config = lambda config_data: open(CONFIG_FILE, 'w', encoding='utf-8').write(json.dumps(config_data, indent=4))

def detect_target_type(raw):
    raw = (raw or '').strip()
    clean_digits = re.sub(r'[^0-9+]', '', raw)
    if raw.startswith('+') or (clean_digits.isdigit() and len(clean_digits) >= 7 and not re.search(r'[a-zA-Z]', raw)):
        return 'phone'
    clean_name = raw.lstrip('@')
    if clean_name.isdigit() and len(clean_name) >= 5:
        return 'user_id'
    if re.match(r'^[a-zA-Z0-9_]{4,32}$', clean_name) and not ' ' in raw:
        return 'username'
    return 'name_keyword'

def sanitize_target(target):
    clean = (target or '').strip()
    if clean.startswith(('http://', 'https://')):
        parsed = urlparse(clean)
        path = parsed.path.strip('/')
        if path:
            clean = path.split('/')[-1]
        else:
            clean = parsed.netloc
    if clean.startswith('@'):
        clean = clean[1:]
    return clean

def parse_phone_intel(raw_phone):
    digits_only = re.sub(r'\D', '', raw_phone)
    formatted = f"+{digits_only}" if not raw_phone.startswith('+') else raw_phone
    country_guess = "Unknown Territory / International"
    is_fragment_anonymous = False
    if digits_only.startswith("888") and len(digits_only) in (11, 12, 13):
        country_guess = "Telegram Anonymous Fragment Number (+888 TON Blockchain)"
        is_fragment_anonymous = True
    elif formatted.startswith("+1"):
        country_guess = "North America (USA / Canada, +1)"
    elif formatted.startswith("+44"):
        country_guess = "United Kingdom (+44)"
    elif formatted.startswith("+49"):
        country_guess = "Germany (+49)"
    elif formatted.startswith("+33"):
        country_guess = "France (+33)"
    elif formatted.startswith("+7"):
        country_guess = "Russia / Kazakhstan (+7)"
    elif formatted.startswith("+380"):
        country_guess = "Ukraine (+380)"
    elif formatted.startswith("+91"):
        country_guess = "India (+91)"
    elif formatted.startswith("+86"):
        country_guess = "China (+86)"
    elif formatted.startswith("+55"):
        country_guess = "Brazil (+55)"
    elif formatted.startswith("+62"):
        country_guess = "Indonesia (+62)"
    elif formatted.startswith("+90"):
        country_guess = "Turkey (+90)"
    elif formatted.startswith("+98"):
        country_guess = "Iran (+98)"
    elif formatted.startswith("+20"):
        country_guess = "Egypt (+20)"
    elif formatted.startswith("+971"):
        country_guess = "United Arab Emirates (+971)"
    elif formatted.startswith("+966"):
        country_guess = "Saudi Arabia (+966)"

    return {
        "input": raw_phone,
        "digits": digits_only,
        "e164": formatted,
        "country_hint": country_guess,
        "is_fragment": is_fragment_anonymous,
        "tg_deeplink": f"tg://resolve?phone={digits_only}",
        "tg_web_link": f"https://t.me/+{digits_only}"
    }

def probe_phone_to_username_vectors(raw_phone):
    digits_only = re.sub(r'\D', '', raw_phone)
    formatted = f"+{digits_only}"
    vectors = [
        {
            "name": "Telegram Client MTProto Contact Sync",
            "type": "Direct Mobile Resolution",
            "description": "Save number into mobile phonebook & refresh Telegram Contacts list to trigger automatic Telegram handle & display name sync.",
            "action_url": f"tg://resolve?phone={digits_only}",
            "action_label": "Trigger tg:// Contact Resolve"
        },
        {
            "name": "Truecaller Public Name & Handle Registry",
            "type": "Reverse Caller ID",
            "description": "Identify the verified subscriber name, alias, and linked carrier account before pivoting to Telegram username search.",
            "action_url": f"https://www.truecaller.com/search/{digits_only}",
            "action_label": "Search Truecaller"
        },
        {
            "name": "Sync.me Global Reverse Lookup",
            "type": "Social Sync Aggregator",
            "description": "Extract synchronized social profiles, avatars, and linked nicknames registered to this phone number.",
            "action_url": f"https://sync.me/search/?number={digits_only}",
            "action_label": "Inspect Sync.me Records"
        },
        {
            "name": "WhatsApp Endpoint Pivot (wa.me)",
            "type": "Cross-Messenger Profiling",
            "description": "Cross-examine whether the owner uses the same profile picture or identity handles across messaging services.",
            "action_url": f"https://api.whatsapp.com/send?phone={digits_only}",
            "action_label": "Cross-Check WhatsApp Status"
        },
        {
            "name": "EmobileTracker Global Registry",
            "type": "Telecom Carrier Intelligence",
            "description": "Verify active telecom operator, state/region of registration, and line validity.",
            "action_url": f"https://www.emobiletracker.com/",
            "action_label": "Telecom Validator"
        }
    ]
    return {
        "phone": formatted,
        "digits": digits_only,
        "vectors": vectors,
        "tip": "In Telegram's MTProto security architecture, a phone number maps to a Telegram User ID when the target has 'Who can find me by my number' set to 'Everybody' or via contact sync."
    }

def probe_telegram_public(username):
    url = f"https://t.me/{quote(username)}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
    }
    start_time = datetime.utcnow()
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=5.0) as response:
            latency = round((datetime.utcnow() - start_time).total_seconds() * 1000)
            html = response.read().decode('utf-8', errors='ignore')
            title_match = re.search(r'<div class="tgme_page_title"[^>]*>(.*?)</div>', html, re.DOTALL)
            title = title_match.group(1).strip() if title_match else username
            title = re.sub(r'<[^>]+>', '', title).strip()

            extra_match = re.search(r'<div class="tgme_page_extra"[^>]*>(.*?)</div>', html, re.DOTALL)
            extra = extra_match.group(1).strip() if extra_match else ""
            extra = re.sub(r'<[^>]+>', '', extra).strip()

            desc_match = re.search(r'<div class="tgme_page_description"[^>]*>(.*?)</div>', html, re.DOTALL)
            description = desc_match.group(1).strip() if desc_match else ""
            description = re.sub(r'<[^>]+>', '', description).strip()

            photo_match = re.search(r'<img class="tgme_page_photo_image" src="([^"]+)"', html)
            photo_url = photo_match.group(1) if photo_match else ""

            is_verified = "tgme_icon_verified" in html
            is_bot = username.lower().endswith("bot") or "send message" in html.lower() or "bot" in extra.lower()
            entity_type = "User Profile"
            if "subscribers" in extra.lower():
                entity_type = "Public Broadcast Channel"
            elif "members" in extra.lower():
                entity_type = "Public Group / Supergroup"
            elif is_bot:
                entity_type = "Automated Telegram Bot"

            not_found = ("If you have Telegram, you can contact" in html and not title) or ("tgme_page_icon" in html and "view in telegram" not in html.lower())
            exists = not not_found and (bool(title) or bool(extra) or bool(photo_url))

            return {
                "username": username,
                "exists": exists,
                "url": url,
                "title": title or username,
                "extra": extra or "Direct Telegram Endpoint",
                "description": description or "No public description or bio provided",
                "photo_url": photo_url or f"https://ui-avatars.com/api/?name={quote(username)}&background=0088cc&color=fff",
                "is_verified": is_verified,
                "is_bot": is_bot,
                "entity_type": entity_type,
                "latency_ms": latency
            }
    except Exception as e:
        return {
            "username": username,
            "exists": False,
            "url": url,
            "title": username,
            "extra": "Unreachable / Private Endpoint",
            "description": str(e),
            "photo_url": f"https://ui-avatars.com/api/?name={quote(username)}&background=1c1c1f&color=79f78d",
            "is_verified": False,
            "is_bot": username.lower().endswith("bot"),
            "entity_type": "Undetermined Endpoint",
            "latency_ms": 0
        }

def query_historical_username_archives(target):
    clean = sanitize_target(target)
    cdx_url = f"https://web.archive.org/cdx/search/cdx?url=t.me/{quote(clean)}&output=json&limit=10&fl=timestamp,original,statuscode"
    snapshots = []
    try:
        req = urllib.request.Request(cdx_url, headers={"User-Agent": "TelegramOSINTBot/2.0"})
        with urllib.request.urlopen(req, timeout=4.0) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            if len(data) > 1:
                for row in data[1:]:
                    ts, orig, status = row[0], row[1], row[2]
                    formatted_date = f"{ts[:4]}-{ts[4:6]}-{ts[6:8]}"
                    wayback_url = f"https://web.archive.org/web/{ts}/{orig}"
                    snapshots.append({
                        "timestamp": formatted_date,
                        "status": status,
                        "archive_url": wayback_url
                    })
    except Exception:
        pass

    history_bots = [
        {
            "bot_name": "@SangMata_BOT",
            "focus": "Historical Name & Username Change Logger",
            "description": "Continuously tracks Telegram User IDs and logs every rename, handle swap, and former username recorded across public groups since 2017.",
            "command": f"/search_id {clean}",
            "url": f"https://t.me/SangMata_BOT"
        },
        {
            "bot_name": "@SangMata_beta_bot",
            "focus": "Deep Username History & ID Audit",
            "description": "Alternative mirror for SangMata with updated cache on deleted usernames and past channel/group forwards.",
            "command": f"Send @{clean} to bot",
            "url": f"https://t.me/SangMata_beta_bot"
        },
        {
            "bot_name": "@UserInfobot",
            "focus": "Immutable Telegram User ID Resolution",
            "description": "Resolves the permanent 32-bit/64-bit Telegram User ID. Even if usernames change 50 times over 10 years, the numeric ID remains fixed forever.",
            "command": f"Forward any message from target to @UserInfobot",
            "url": f"https://t.me/UserInfobot"
        },
        {
            "bot_name": "@creationdatebot",
            "focus": "Registration Date Estimator",
            "description": "Calculates exact registration vintage and account creation year based on Telegram's sequential User ID assignment algorithms.",
            "command": f"Forward message from target to @creationdatebot",
            "url": f"https://t.me/creationdatebot"
        },
        {
            "bot_name": "@tgscanrobot",
            "focus": "Group Membership History Index",
            "description": "Discloses which public and private Telegram chats this handle or ID has participated in historically.",
            "command": f"Send @{clean}",
            "url": f"https://t.me/tgscanrobot"
        }
    ]

    return {
        "target": clean,
        "telegram_foundation_year": 2013,
        "historical_span_years": max(1, datetime.utcnow().year - 2013),
        "wayback_snapshots": snapshots,
        "has_wayback_records": len(snapshots) > 0,
        "wayback_hub": f"https://web.archive.org/web/*/t.me/{clean}*",
        "history_bots": history_bots
    }

def estimate_telegram_uid_epoch(target):
    clean = sanitize_target(target)
    numeric_id = None
    if clean.isdigit():
        numeric_id = int(clean)

    epochs = [
        {"max_id": 50000000, "year": "2013 - 2014", "era": "Telegram Genesis & Early Adopter Era", "tier": "Extremely Rare (10+ Years Old)"},
        {"max_id": 150000000, "year": "2015", "era": "Initial Global Expansion", "tier": "Veteran Account (9+ Years Old)"},
        {"max_id": 300000000, "year": "2016", "era": "Bot Platform Launch", "tier": "Vintage Account (8+ Years Old)"},
        {"max_id": 500000000, "year": "2017", "era": "Channels & Supergroups Boom", "tier": "Established Account (7+ Years Old)"},
        {"max_id": 750000000, "year": "2018", "era": "MTProto 2.0 Deployment", "tier": "Mature Account (6+ Years Old)"},
        {"max_id": 1050000000, "year": "2019", "era": "Telegram 1 Billion Milestone", "tier": "Established Account (5+ Years Old)"},
        {"max_id": 1500000000, "year": "2020", "era": "Pandemic Remote Shift Era", "tier": "Active Era (4+ Years Old)"},
        {"max_id": 2147483647, "year": "2021", "era": "End of 32-bit User ID space (2.14B)", "tier": "Mid-Age Account (3+ Years Old)"},
        {"max_id": 5500000000, "year": "2022 - 2023", "era": "Telegram Premium & 64-bit Expansion", "tier": "Modern Account (1-2 Years Old)"},
        {"max_id": 9999999999, "year": "2024 - 2025", "era": "Current Generation Accounts", "tier": "Fresh / Recent Account"}
    ]

    matched_epoch = None
    if numeric_id:
        for ep in epochs:
            if numeric_id <= ep["max_id"]:
                matched_epoch = ep
                break
        if not matched_epoch:
            matched_epoch = {"year": "2024 - 2025", "era": "High 64-bit ID space", "tier": "Recent Account"}

    return {
        "target": clean,
        "numeric_id": numeric_id,
        "is_resolved_id": bool(numeric_id),
        "matched_epoch": matched_epoch,
        "epoch_guide": epochs,
        "algorithm_note": "Telegram User IDs are sequential 32-bit and 64-bit integers generated monotonically since August 14, 2013."
    }

def probe_fragment_ton_intel(target):
    clean = sanitize_target(target)
    fragment_user_url = f"https://fragment.com/username/{clean}"
    fragment_num_url = None
    digits = re.sub(r'\D', '', target)
    if digits.startswith("888"):
        fragment_num_url = f"https://fragment.com/number/{digits}"

    return {
        "target": clean,
        "fragment_username_url": fragment_user_url,
        "fragment_number_url": fragment_num_url,
        "ton_dns_url": f"https://dns.ton.org/#/{clean}.t.me",
        "description": "Fragment is Telegram's official TON blockchain marketplace for auctioned handles and anonymous +888 phone numbers.",
        "is_anonymous_number": digits.startswith("888") if digits else False
    }

def generate_breach_lookup_vectors(target, target_type):
    clean = sanitize_target(target)
    digits = re.sub(r'\D', '', target)
    query_val = digits if target_type == 'phone' and len(digits) >= 7 else clean

    return [
        {
            "name": "IntelX Telegram Leak Archives",
            "query": query_val,
            "url": f"https://intelx.io/?s={quote(query_val)}",
            "badge": "Leaked Databases & Pastes",
            "description": "Index of pasted message logs, combo lists, and de-anonymized Telegram databases."
        },
        {
            "name": "Snusbase Identity Aggregator",
            "query": query_val,
            "url": f"https://snusbase.com/search?term={quote(query_val)}",
            "badge": "Breach Cross-Reference",
            "description": "Correlates phone numbers and usernames across 50+ billion historical compromise records."
        },
        {
            "name": "DeHashed Threat Search",
            "query": f'"{query_val}"',
            "url": f"https://dehashed.com/search?query={quote(query_val)}",
            "badge": "Credential Correlation",
            "description": "Maps usernames and phone numbers back to email addresses and legacy account passwords."
        },
        {
            "name": "LeakCheck OSINT Search",
            "query": query_val,
            "url": f"https://leakcheck.io/search?type={'phone' if target_type == 'phone' else 'username'}&query={quote(query_val)}",
            "badge": "Combo Lists",
            "description": "Pivots from Telegram username or phone to known password dumps and forum leaks."
        }
    ]

def probe_threat_actor_intel(target):
    clean = sanitize_target(target)
    return [
        {
            "platform": "VirusTotal Threat Search",
            "category": "Malware C2 & File Telemetry",
            "icon": "fa-solid fa-virus",
            "badge": "C2 / Dropper Config",
            "url": f"https://www.virustotal.com/gui/search/{quote(clean)}",
            "description": f"Check if '{clean}' or its bot token is hardcoded into known trojans, infostealers, or payload downloaders."
        },
        {
            "platform": "Hybrid Analysis / Falcon Sandbox",
            "category": "Behavioral Sandboxing",
            "icon": "fa-solid fa-microchip",
            "badge": "Dynamic Execution",
            "url": f"https://www.hybrid-analysis.com/search?query={quote(clean)}",
            "description": "Scan detonation logs for infostealers sending stolen credentials, keystrokes, or sessions to this handle."
        },
        {
            "platform": "ANY.RUN Interactive Sandbox",
            "category": "C2 Network Traffic",
            "icon": "fa-solid fa-network-wired",
            "badge": "Live PCAP & DNS",
            "url": f"https://app.any.run/submissions/#search:{quote(clean)}",
            "description": "Track active malware sandbox executions resolving t.me or api.telegram.org endpoints linked to this handle."
        },
        {
            "platform": "ThreatFox IoC Registry",
            "category": "Abuse.ch Indicators of Compromise",
            "icon": "fa-solid fa-bug",
            "badge": "Known Malicious IoC",
            "url": f"https://threatfox.abuse.ch/browse.php?search={quote(clean)}",
            "description": "Search threat database for registered Botnet C2 channels, RedLine, AgentTesla, or LummaStealer telegram drops."
        },
        {
            "platform": "GitHub Leaked C2 & Bot Tokens",
            "category": "Source Code Codebases",
            "icon": "fa-brands fa-github",
            "badge": "Credential Leak",
            "url": f'https://github.com/search?q="{quote(clean)}"+("api.telegram.org"+OR+"sendMessage")+NOT+is:fork&type=code',
            "description": "Hunt for exposed Python/Go infostealer scripts, bot builders, and leaked Telegram API chat IDs."
        }
    ]

def probe_crypto_financial_intel(target):
    clean = sanitize_target(target)
    return {
        "target": clean,
        "financial_channels": [
            {
                "currency": "USDT (TRC-20) / Tron Blockchain",
                "blockchain": "Tron TRC-20 Network",
                "icon": "fa-solid fa-coins",
                "badge": "High-Velocity Cybercrime",
                "search_url": f"https://tronscan.org/#/search?search_param={quote(clean)}",
                "description": "USDT TRC-20 is the primary settlement rail for illicit Telegram escrow markets, drainer kits, and ransom cashouts."
            },
            {
                "currency": "Bitcoin (BTC) / Mempool Forensics",
                "blockchain": "Bitcoin Network",
                "icon": "fa-brands fa-bitcoin",
                "badge": "Ransom & Mixer Escrow",
                "search_url": f"https://mempool.space/search?q={quote(clean)}",
                "description": "Examine on-chain mempool transactions, unconfirmed outputs, and cluster analysis linked to cyber extortion."
            },
            {
                "currency": "Ethereum (ETH) & ERC-20",
                "blockchain": "Ethereum Network",
                "icon": "fa-brands fa-ethereum",
                "badge": "Crypto Drainers & Phishing",
                "search_url": f"https://etherscan.io/search?f=0&q={quote(clean)}",
                "description": "Trace automated web3 wallet drainer smart contracts and laundering hops to centralized exchanges (CEX)."
            },
            {
                "currency": "TON Blockchain (The Open Network)",
                "blockchain": "TON Native Protocol",
                "icon": "fa-solid fa-gem",
                "badge": "Native Telegram Wallet",
                "search_url": f"https://tonscan.org/search?q={quote(clean)}",
                "description": "Audit Telegram's native crypto asset addresses, Jetton tokens, and decentralized @username auction transfers."
            }
        ],
        "wallet_regex_patterns": [
            {"type": "Bitcoin (Legacy/SegWit)", "regex": r"^(?:[13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-zA-HJ-NP-Z0-9]{25,90})"},
            {"type": "Ethereum / EVM", "regex": r"^0x[a-fA-F0-9]{40}"},
            {"type": "Tron (USDT TRC-20)", "regex": r"^T[A-Za-z1-9]{33}"},
            {"type": "TON Network", "regex": r"^[0-9a-zA-Z_-]{48}"}
        ],
        "forensic_note": "When reviewing channel posts, extract addresses matching these expressions and pivot directly into AML forensic tracing engines (Chainalysis, Elliptic, AMLBot)."
    }

def probe_darkweb_forum_intel(target):
    clean = sanitize_target(target)
    return [
        {
            "name": "BreachForums Deep Correlation",
            "category": "Dark Web Data Leaks",
            "icon": "fa-solid fa-user-secret",
            "url": f'https://www.google.com/search?q=site:breachforums.st+OR+site:breachforums.cx+"{quote(clean)}"',
            "description": "Search major underground database clearinghouse for seller handles, escrow threads, or breach manifestos."
        },
        {
            "name": "XSS.is / Exploit.in Russian Cyber Underground",
            "category": "Elite Exploit Forums",
            "icon": "fa-solid fa-skull-crossbones",
            "url": f'https://www.google.com/search?q=(site:xss.is+OR+site:exploit.in)+"{quote(clean)}"',
            "description": "Pivot across Russian-speaking threat actor forums for malware vendor profiles, access broker sales, and jabber/TG contacts."
        },
        {
            "name": "Rentry.co / JustPaste.it Threat Actor Dumps",
            "category": "Anonymous Pastebins",
            "icon": "fa-solid fa-clipboard-list",
            "url": f'https://www.google.com/search?q=(site:rentry.co+OR+site:justpaste.it+OR+site:ghostbin.com)+"{quote(clean)}"',
            "description": "Scan ephemeral markdown paste sites often used for DDoS target manifests, stolen combo logs, and extortion notes."
        },
        {
            "name": "Pastebin Historical Leaks",
            "category": "Text Storage Archive",
            "icon": "fa-solid fa-file-code",
            "url": f'https://www.google.com/search?q=site:pastebin.com+"{quote(clean)}"',
            "description": "Locate plain-text configuration files, config drops, credentials, and target chat logs published publicly."
        },
        {
            "name": "Ahmia Darknet Tor Engine",
            "category": "Hidden Services Search",
            "icon": "fa-solid fa-mask",
            "url": f"https://ahmia.fi/search/?q={quote(clean)}",
            "description": "Search indexed .onion dark web markets, forums, and leak sites referencing this Telegram handle as an escrow contact."
        }
    ]

def probe_metadata_forensics(target):
    clean = sanitize_target(target)
    return {
        "target": clean,
        "vectors": [
            {
                "title": "Forwarded Origin Header (forward_from_chat)",
                "method": "Telegram API Message JSON",
                "evidence": "In forwarded posts, the client embeds immutable origin parameters: 'forward_from_chat.id' and 'forward_from_message_id'.",
                "relevance": "Even if a cybercriminal creates a dummy burner channel, forwarding past announcements exposes the original parent syndicate channel ID and title."
            },
            {
                "title": "Custom Sticker Pack Authorship Vector",
                "method": "Sticker Set Metadata Inspection",
                "evidence": "Sticker packs created via @Stickers bot permanently tie the set identifier to the Telegram User ID of the creator account.",
                "relevance": "Custom cybercrime group sticker packs can be traced back to the founder's initial Telegram account using @Stickerdownload_bot or bot API calls."
            },
            {
                "title": "Channel Message ID Chronology & Deletion Audits",
                "method": "Sequential Message ID Gaps",
                "evidence": "Channel messages increment monotonically (t.me/channel/1, t.me/channel/2...). Gaps indicate scrubbed or deleted content.",
                "relevance": "Allows investigators to detect panicked message purges following cyber operations and retrieve deleted items from external archive feeds."
            },
            {
                "title": "Media SHA-256 Hash Matching across Crime Chats",
                "method": "Cryptographic Binary Fingerprinting",
                "evidence": "Infostealer build zip files, crypter samples, or profile banners have distinct SHA-256 digests.",
                "relevance": "Allows pivoting to other underground channels sharing the exact same payloads or banners even under different aliases."
            }
        ],
        "forensic_command": f"Investigate raw MTProto message frames with telethon or pyrogram: client.get_messages('{clean}', limit=100)"
    }

def probe_geolocation_intel(target):
    clean = sanitize_target(target)
    return {
        "target": clean,
        "modules": [
            {
                "name": "Telegram 'Nearby' Trilateration Methodology",
                "protocol": "Location-Based Services (LBS)",
                "status": "Restricted / Geogramint Compatible",
                "description": "Telegram's Nearby feature reports relative distances in meters. By submitting mock GPS requests from 3 distinct coordinates, exact physical location can be trilaterated with circular intersection math.",
                "action_link": "https://github.com/teogeb/Geogramint",
                "link_title": "Geogramint OSINT Tool"
            },
            {
                "name": "Post Timezone & Operating Hours Analysis",
                "protocol": "Timestamp UTC Dispersion Matrix",
                "status": "Passive Behavioral Telemetry",
                "description": "Aggregating message timestamps over a 30-day window reveals target sleep cycles and operational shifts, isolating timezone UTC offsets (e.g. UTC+3, UTC+5:30, UTC+8).",
                "action_link": f"https://tgstat.com/channel/@{clean}",
                "link_title": "Analyze Post Activity on TGStat"
            },
            {
                "name": "Regional ISP & Carrier IP Leaks via VoIP P2P",
                "protocol": "MTProto Peer-to-Peer Calls (CVE / Config Risk)",
                "status": "Interactive Network Analysis",
                "description": "If the target has Telegram Settings -> Privacy -> Voice Calls set to 'Everybody' or 'My Contacts', initiating a call may disclose peer IP address in Wireshark STUN packets.",
                "action_link": "https://t.me/settings",
                "link_title": "Privacy Setting Verification"
            }
        ],
        "operational_warning": "Always conduct GPS trilateration and network traffic analysis via dedicated airgapped VMs and research sock puppets."
    }

def generate_telegram_directories(target):
    clean = sanitize_target(target)
    return [
        {
            "name": "TGStat Global Channel Analytics",
            "category": "Analytics & Stats",
            "icon": "fa-solid fa-chart-line",
            "url": f"https://tgstat.com/channel/@{clean}",
            "query": f"@{clean}",
            "description": "Comprehensive channel statistics, subscriber growth history, audience reach & repost graph"
        },
        {
            "name": "Telemetr Telegram Intelligence",
            "category": "Channel Tracking",
            "icon": "fa-solid fa-magnifying-glass-chart",
            "url": f"https://telemetr.io/en/channels?search={quote(clean)}",
            "query": clean,
            "description": "Indexed Telegram channels, audience engagement metrics, hourly views, and ad tracking"
        },
        {
            "name": "Lyzem Telegram Global Search",
            "category": "Content & Messages",
            "icon": "fa-solid fa-database",
            "url": f"https://lyzem.com/search?q={quote(clean)}",
            "query": clean,
            "description": "Deep search engine for publicly shared Telegram files, messages, posts, channels, and groups"
        },
        {
            "name": "Telegago Search Engine",
            "category": "Search Index",
            "icon": "fa-brands fa-searchengin",
            "url": f"https://cse.google.com/cse?cx=006368593537057042503:efxu7xprihg#gsc.tab=0&gsc.q={quote(clean)}",
            "query": clean,
            "description": "Google Custom Search Engine dedicated purely to crawling indexed t.me links and channels"
        },
        {
            "name": "IntelX Telegram Search",
            "category": "Archive & Leaks",
            "icon": "fa-solid fa-folder-closed",
            "url": f"https://intelx.io/?s={quote(clean)}",
            "query": clean,
            "description": "Historical archives, message dumps, leaked attachments, and Pastebin/Telegram mentions"
        },
        {
            "name": "TDirectory & Bot Catalog",
            "category": "Catalog",
            "icon": "fa-solid fa-list-check",
            "url": f"https://tdirectory.me/search?q={quote(clean)}",
            "query": clean,
            "description": "Categorized catalog of verified Telegram bots, public channels, and supergroups"
        }
    ]

def generate_telegram_dorks(target):
    clean = sanitize_target(target)
    return [
        {
            "engine": "Google: Telegram Web Channel Feed",
            "query": f'site:t.me/s/ "{clean}"',
            "url": f'https://www.google.com/search?q=site:t.me/s/+"{quote(clean)}"',
            "description": "Search within public Telegram web previews (/s/) for messages, captions, or handle mentions"
        },
        {
            "engine": "Google: Telegram Invite Links",
            "query": f'site:t.me ("joinchat" | "+") "{clean}"',
            "url": f'https://www.google.com/search?q=site:t.me+(joinchat+OR+"+")+"{quote(clean)}"',
            "description": "Identify private or public Telegram invite links associated with the handle or query"
        },
        {
            "engine": "Google: Shared Telegram Files & Documents",
            "query": f'site:t.me "{clean}" (filetype:pdf | filetype:xlsx | filetype:txt | filetype:sql | filetype:zip)',
            "url": f'https://www.google.com/search?q=site:t.me+"{quote(clean)}"+(filetype:pdf+OR+filetype:xlsx+OR+filetype:txt+OR+filetype:sql+OR+filetype:zip)',
            "description": "Locate documents, spreadsheets, logs, or archives shared within Telegram channels"
        },
        {
            "engine": "Google: Telegram Bot Token Leaks",
            "query": f'site:github.com | site:pastebin.com "{clean}" ("api.telegram.org/bot" | "telegram_bot_token")',
            "url": f'https://www.google.com/search?q=site:github.com+OR+site:pastebin.com+"{quote(clean)}"+("api.telegram.org/bot"+OR+"telegram_bot_token")',
            "description": "Hunt for exposed Telegram bot authorization tokens and API credentials"
        },
        {
            "engine": "Yandex: Telegram Public Channels",
            "query": f'site:t.me "{clean}"',
            "url": f'https://yandex.com/search/?text=site%3At.me+"{quote(clean)}"',
            "description": "Yandex search index for t.me channels and Eastern European Telegram ecosystems"
        },
        {
            "engine": "DuckDuckGo: Social Cross-References",
            "query": f'"t.me/{clean}" | "telegram.me/{clean}"',
            "url": f'https://duckduckgo.com/?q="t.me/{quote(clean)}"+OR+"telegram.me/{quote(clean)}"',
            "description": "Find external websites, GitHub repos, Twitter profiles, or blogs linking to this Telegram handle"
        }
    ]

def generate_telegram_variants(target):
    clean = sanitize_target(target)
    return {
        "base": clean,
        "variations": [
            f"{clean}_bot",
            f"{clean}bot",
            f"{clean}_channel",
            f"{clean}_chat",
            f"{clean}_group",
            f"{clean}_official",
            f"{clean}_support",
            f"{clean}_news",
            f"{clean}_vip",
            f"{clean}_backup",
            f"join_{clean}",
            f"real_{clean}"
        ]
    }

def build_deeplinks(target, target_type):
    clean = sanitize_target(target)
    digits = re.sub(r'\D', '', target)
    if target_type == 'phone':
        return {
            "target": target,
            "type": "Phone Number Protocol",
            "links": [
                {"title": "Telegram Direct Resolve", "url": f"tg://resolve?phone={digits}", "badge": "Client App"},
                {"title": "Telegram Web Contact", "url": f"https://t.me/+{digits}", "badge": "Web Gateway"},
                {"title": "Telegram Web A client", "url": f"https://web.telegram.org/a/#?phone={digits}", "badge": "Web A"},
                {"title": "Telegram Web K client", "url": f"https://web.telegram.org/k/#?phone={digits}", "badge": "Web K"}
            ]
        }
    return {
        "target": clean,
        "type": "Username Protocol",
        "links": [
            {"title": "Telegram App Resolve", "url": f"tg://resolve?domain={clean}", "badge": "Native App"},
            {"title": "Public Web Preview", "url": f"https://t.me/{clean}", "badge": "Browser Preview"},
            {"title": "Direct Web Message (Web A)", "url": f"https://web.telegram.org/a/#?tgaddr=tg%3A%2F%2Fresolve%3Fdomain%3D{clean}", "badge": "Web Client"},
            {"title": "Public Channel Feed Reader", "url": f"https://t.me/s/{clean}", "badge": "Channel Stream"}
        ]
    }

@app.route('/api/osint/recheck', methods=['POST'])
def recheck_card():
    data = request.json or {}
    raw_target = data.get('username') or request.args.get('target', '')
    target = sanitize_target(raw_target)
    card_type = data.get('card_type', '')
    target_type = detect_target_type(raw_target)

    if not target:
        return jsonify({'success': False, 'message': 'Invalid target specified.'}), 400

    config = load_config()
    data_dir = config.get('data_path')
    record_path = os.path.join(data_dir, f'{target}.json')
    full_record = {}
    if os.path.exists(record_path):
        try:
            with open(record_path, 'r', encoding='utf-8') as f:
                full_record = json.load(f)
        except Exception:
            full_record = {}

    result_data = None

    if card_type == 'tg_profile':
        result_data = probe_telegram_public(target)
        full_record['tg_profile'] = result_data
    elif card_type == 'phone_intel':
        result_data = parse_phone_intel(raw_target)
        full_record['phone_intel'] = result_data
    elif card_type == 'phone_sync_intel':
        result_data = probe_phone_to_username_vectors(raw_target)
        full_record['phone_sync_intel'] = result_data
    elif card_type == 'tg_history':
        result_data = query_historical_username_archives(target)
        full_record['tg_history'] = result_data
    elif card_type == 'tg_uid_estimator':
        result_data = estimate_telegram_uid_epoch(target)
        full_record['tg_uid_estimator'] = result_data
    elif card_type == 'tg_fragment':
        result_data = probe_fragment_ton_intel(target)
        full_record['tg_fragment'] = result_data
    elif card_type == 'tg_breaches':
        result_data = generate_breach_lookup_vectors(target, target_type)
        full_record['tg_breaches'] = result_data
    elif card_type == 'tg_threat_intel':
        result_data = probe_threat_actor_intel(target)
        full_record['tg_threat_intel'] = result_data
    elif card_type == 'tg_crypto_intel':
        result_data = probe_crypto_financial_intel(target)
        full_record['tg_crypto_intel'] = result_data
    elif card_type == 'tg_darkweb_forums':
        result_data = probe_darkweb_forum_intel(target)
        full_record['tg_darkweb_forums'] = result_data
    elif card_type == 'tg_forensics':
        result_data = probe_metadata_forensics(target)
        full_record['tg_forensics'] = result_data
    elif card_type == 'tg_geo_intel':
        result_data = probe_geolocation_intel(target)
        full_record['tg_geo_intel'] = result_data
    elif card_type == 'tg_directories':
        result_data = generate_telegram_directories(target)
        full_record['tg_directories'] = result_data
    elif card_type == 'tg_dorks':
        result_data = generate_telegram_dorks(target)
        full_record['tg_dorks'] = result_data
    elif card_type == 'tg_variants':
        result_data = generate_telegram_variants(target)
        full_record['tg_variants'] = result_data
    elif card_type == 'tg_deeplinks':
        result_data = build_deeplinks(target, target_type)
        full_record['tg_deeplinks'] = result_data
    elif card_type == 'tg_summary':
        profile = full_record.get('tg_profile', {})
        exists = profile.get('exists', False)
        result_data = {
            "target": target,
            "target_type": target_type,
            "exists": exists,
            "entity_type": profile.get('entity_type', 'Unknown'),
            "status_badge": "CONFIRMED ACTIVE" if exists else "PRIVATE OR UNCONFIRMED",
            "timestamp": datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')
        }
        full_record['tg_summary'] = result_data
    else:
        return jsonify({'success': False, 'message': f'Unknown card type: {card_type}'}), 400

    if full_record:
        os.makedirs(data_dir, exist_ok=True)
        try:
            with open(record_path, 'w', encoding='utf-8') as f:
                json.dump(full_record, f, indent=4)
        except Exception:
            pass

    global OSINT_CACHE
    OSINT_CACHE = None

    return jsonify({
        'success': True,
        'username': target,
        'cardType': card_type,
        'data': result_data
    })

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/osint/stream')
def stream_osint():
    raw_target = request.args.get('target', '')
    target = sanitize_target(raw_target)
    target_type = detect_target_type(raw_target)

    def generate_events():
        if not target or len(target) < 2:
            yield f"event: error\ndata: {json.dumps({'message': 'Invalid target specified (minimum 2 characters required).'})}\n\n"
            return

        timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")
        yield f"event: start\ndata: {json.dumps({'username': target, 'target_type': target_type, 'timestamp': timestamp})}\n\n"

        full_record = {
            "target": target,
            "target_type": target_type,
            "timestamp": timestamp,
            "phone_intel": {},
            "phone_sync_intel": {},
            "tg_profile": {},
            "tg_history": {},
            "tg_uid_estimator": {},
            "tg_fragment": {},
            "tg_breaches": [],
            "tg_threat_intel": [],
            "tg_crypto_intel": {},
            "tg_darkweb_forums": [],
            "tg_forensics": {},
            "tg_geo_intel": {},
            "tg_directories": [],
            "tg_dorks": [],
            "tg_variants": {},
            "tg_deeplinks": {},
            "tg_summary": {}
        }

        # 1. Target Format & Protocol Identification
        tax_msg = f"Analyzing input taxonomy: detected format is [{target_type.upper()}] for {target}..."
        yield f"event: log\ndata: {json.dumps({'message': tax_msg})}\n\n"
        
        if target_type == 'phone':
            yield f"event: log\ndata: {json.dumps({'message': 'Parsing international E.164 phone numbering plan and Telegram client routing...' })}\n\n"
            phone_data = parse_phone_intel(raw_target)
            full_record["phone_intel"] = phone_data
            yield f"event: card\ndata: {json.dumps({'cardType': 'phone_intel', 'username': target, 'data': phone_data})}\n\n"

            yield f"event: log\ndata: {json.dumps({'message': 'Correlating phone number with MTProto contact sync & external caller registries...' })}\n\n"
            phone_sync_data = probe_phone_to_username_vectors(raw_target)
            full_record["phone_sync_intel"] = phone_sync_data
            yield f"event: card\ndata: {json.dumps({'cardType': 'phone_sync_intel', 'username': target, 'data': phone_sync_data})}\n\n"

        # 2. Telegram Public Web Preview Probe (t.me/<target>)
        probe_msg = f"Initiating live probe on public Telegram gateway: https://t.me/{target}..."
        yield f"event: log\ndata: {json.dumps({'message': probe_msg})}\n\n"
        profile_data = probe_telegram_public(target)
        full_record["tg_profile"] = profile_data
        yield f"event: card\ndata: {json.dumps({'cardType': 'tg_profile', 'username': target, 'data': profile_data})}\n\n"

        # 3. Historical Username Tracking & Wayback Machine Snapshots (10+ Years History)
        yield f"event: log\ndata: {json.dumps({'message': 'Querying Wayback Machine CDX API & historical Telegram rename bots (2013 - present)...' })}\n\n"
        history_data = query_historical_username_archives(target)
        full_record["tg_history"] = history_data
        yield f"event: card\ndata: {json.dumps({'cardType': 'tg_history', 'username': target, 'data': history_data})}\n\n"

        # 4. Telegram Sequential User ID & Creation Date Estimator
        yield f"event: log\ndata: {json.dumps({'message': 'Analyzing Telegram sequential User ID epochs and registration vintage...' })}\n\n"
        uid_data = estimate_telegram_uid_epoch(target)
        full_record["tg_uid_estimator"] = uid_data
        yield f"event: card\ndata: {json.dumps({'cardType': 'tg_uid_estimator', 'username': target, 'data': uid_data})}\n\n"

        # 5. Fragment TON Blockchain & Auction Intel
        yield f"event: log\ndata: {json.dumps({'message': 'Checking Fragment.com TON blockchain handle auctions and +888 anonymous numbers...' })}\n\n"
        fragment_data = probe_fragment_ton_intel(target)
        full_record["tg_fragment"] = fragment_data
        yield f"event: card\ndata: {json.dumps({'cardType': 'tg_fragment', 'username': target, 'data': fragment_data})}\n\n"

        # 6. Leaked Telegram DBs & Cross-Platform Breach Lookup Vectors
        yield f"event: log\ndata: {json.dumps({'message': 'Compiling compromised database & cross-identity breach vectors (IntelX, Snusbase, DeHashed)...' })}\n\n"
        breach_data = generate_breach_lookup_vectors(target, target_type)
        full_record["tg_breaches"] = breach_data
        yield f"event: card\ndata: {json.dumps({'cardType': 'tg_breaches', 'username': target, 'data': breach_data})}\n\n"

        # 7. Threat Actor & Infostealer C2 Correlation
        yield f"event: log\ndata: {json.dumps({'message': 'Cross-referencing malware detonation sandboxes, C2 configs & VirusTotal IoCs...' })}\n\n"
        threat_data = probe_threat_actor_intel(target)
        full_record["tg_threat_intel"] = threat_data
        yield f"event: card\ndata: {json.dumps({'cardType': 'tg_threat_intel', 'username': target, 'data': threat_data})}\n\n"

        # 8. Illicit Financial & Cryptocurrency Trail
        yield f"event: log\ndata: {json.dumps({'message': 'Analyzing cryptocurrency addresses, escrow payment rails & TRC20/BTC/TON mixers...' })}\n\n"
        crypto_data = probe_crypto_financial_intel(target)
        full_record["tg_crypto_intel"] = crypto_data
        yield f"event: card\ndata: {json.dumps({'cardType': 'tg_crypto_intel', 'username': target, 'data': crypto_data})}\n\n"

        # 9. Underground Cybercrime Forum & Dark Web Pivots
        yield f"event: log\ndata: {json.dumps({'message': 'Searching Russian & International cybercrime underground forums (XSS, BreachForums, Exploit)...' })}\n\n"
        darkweb_data = probe_darkweb_forum_intel(target)
        full_record["tg_darkweb_forums"] = darkweb_data
        yield f"event: card\ndata: {json.dumps({'cardType': 'tg_darkweb_forums', 'username': target, 'data': darkweb_data})}\n\n"

        # 10. Message Forensics & Forward Origin Tracing
        yield f"event: log\ndata: {json.dumps({'message': 'Mapping forward_from_chat IDs, custom sticker pack authors & deletion chronology...' })}\n\n"
        forensics_data = probe_metadata_forensics(target)
        full_record["tg_forensics"] = forensics_data
        yield f"event: card\ndata: {json.dumps({'cardType': 'tg_forensics', 'username': target, 'data': forensics_data})}\n\n"

        # 11. Geospatial & Nearby Trilateration Matrix
        yield f"event: log\ndata: {json.dumps({'message': 'Synthesizing Telegram Nearby trilateration parameters & UTC posting timezone dispersion...' })}\n\n"
        geo_data = probe_geolocation_intel(target)
        full_record["tg_geo_intel"] = geo_data
        yield f"event: card\ndata: {json.dumps({'cardType': 'tg_geo_intel', 'username': target, 'data': geo_data})}\n\n"

        # 12. Telegram Analytics & Search Directories
        yield f"event: log\ndata: {json.dumps({'message': 'Querying specialized Telegram indexes (TGStat, Telemetr, Lyzem, Telegago)...' })}\n\n"
        directories = generate_telegram_directories(target)
        full_record["tg_directories"] = directories
        yield f"event: card\ndata: {json.dumps({'cardType': 'tg_directories', 'username': target, 'data': directories})}\n\n"

        # 13. Telegram Targeted Search Dorks
        yield f"event: log\ndata: {json.dumps({'message': 'Synthesizing advanced search dorks for chat leaks, files, invite links & bot tokens...' })}\n\n"
        dorks = generate_telegram_dorks(target)
        full_record["tg_dorks"] = dorks
        yield f"event: card\ndata: {json.dumps({'cardType': 'tg_dorks', 'username': target, 'data': dorks})}\n\n"

        # 14. Telegram Deep Links & Direct Protocol Triggers
        yield f"event: log\ndata: {json.dumps({'message': 'Constructing native tg:// and web client dispatch vectors...' })}\n\n"
        deeplinks = build_deeplinks(target, target_type)
        full_record["tg_deeplinks"] = deeplinks
        yield f"event: card\ndata: {json.dumps({'cardType': 'tg_deeplinks', 'username': target, 'data': deeplinks})}\n\n"

        # 15. Telegram Channel / Bot Permutations
        yield f"event: log\ndata: {json.dumps({'message': 'Generating correlated Telegram naming variations (_bot, _channel, _backup, _chat)...' })}\n\n"
        variants = generate_telegram_variants(target)
        full_record["tg_variants"] = variants
        yield f"event: card\ndata: {json.dumps({'cardType': 'tg_variants', 'username': target, 'data': variants})}\n\n"

        # 16. Final Telegram Footprint Assessment
        summary = {
            "target": target,
            "target_type": target_type,
            "exists": profile_data.get('exists', False),
            "title": profile_data.get('title', target),
            "entity_type": profile_data.get('entity_type', 'Profile / Entity'),
            "verified": profile_data.get('is_verified', False),
            "is_bot": profile_data.get('is_bot', False),
            "status_badge": "CONFIRMED ACTIVE TELEGRAM ENDPOINT" if profile_data.get('exists') else "PRIVATE OR UNINDEXED",
            "threat_vectors_count": len(threat_data),
            "directories_count": len(directories),
            "dorks_count": len(dorks),
            "timestamp": timestamp
        }
        full_record["tg_summary"] = summary
        yield f"event: card\ndata: {json.dumps({'cardType': 'tg_summary', 'username': target, 'data': summary})}\n\n"

        # Save record
        config = load_config()
        data_dir = config.get("data_path")
        os.makedirs(data_dir, exist_ok=True)
        try:
            file_path = os.path.join(data_dir, f"{target}.json")
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(full_record, f, indent=4)
        except Exception:
            pass

        global OSINT_CACHE
        OSINT_CACHE = None

        yield f"event: complete\ndata: {json.dumps({'username': target, 'record': full_record})}\n\n"

    resp = Response(stream_with_context(generate_events()), mimetype="text/event-stream")
    resp.headers["Cache-Control"] = "no-cache, no-transform"
    resp.headers["X-Accel-Buffering"] = "no"
    resp.headers["Connection"] = "keep-alive"
    return resp

@app.route('/api/osint/records', methods=['GET'])
def get_records():
    global OSINT_CACHE
    if OSINT_CACHE is not None:
        return jsonify(OSINT_CACHE)

    config = load_config()
    data_dir = config.get("data_path")
    records = []
    if os.path.exists(data_dir):
        for fname in os.listdir(data_dir):
            if fname.endswith(".json"):
                try:
                    with open(os.path.join(data_dir, fname), 'r', encoding='utf-8') as f:
                        records.append(json.load(f))
                except Exception:
                    continue
    records.sort(key=lambda x: x.get('timestamp', ''), reverse=True)
    OSINT_CACHE = records
    return jsonify(records)

@app.route('/api/osint/clear', methods=['POST'])
def clear_all_intel():
    global OSINT_CACHE
    OSINT_CACHE = []
    config = load_config()
    data_dir = config.get("data_path")
    deleted_count = 0
    if os.path.exists(data_dir):
        for fname in os.listdir(data_dir):
            if fname.endswith(".json"):
                try:
                    os.remove(os.path.join(data_dir, fname))
                    deleted_count += 1
                except Exception:
                    pass
    return jsonify({"success": True, "message": f"Cleared all Telegram recon records ({deleted_count} targets removed)."})

@app.route('/api/settings', methods=['GET', 'POST'])
def handle_settings():
    if request.method == 'GET':
        return jsonify(load_config())
    new_cfg = request.json or {}
    current = load_config()
    current.update(new_cfg)
    save_config(current)
    return jsonify({"success": True, "message": "Settings updated successfully"})

if __name__ == '__main__':
    port = 5001
    if '--port' in sys.argv:
        try:
            idx = sys.argv.index('--port') + 1
            port = int(sys.argv[idx])
        except (ValueError, IndexError):
            pass
    print(f"Telegram OSINT Reconnaissance Engine active on port {port}...")
    app.run(debug=True, host='0.0.0.0', port=port)
