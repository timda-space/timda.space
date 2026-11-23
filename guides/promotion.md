# Telling people about TIMDA

Sample wording and assets for anyone who wants to spread the word, whether that's about the station or about your own Section docking. Adapt it freely; it's here so nobody has to start from a blank page. Like everything else in TIMDA, none of it is required.

## The pitch

TIMDA is a webring as objet d'art: a living, interactive art installation shaped like a space station. The hub is the station, and a site is a Section that docks to it. The more Sections there are, the more inhabited it feels. If you're explaining it to someone in one line, that's the line.

### A longer post

A forum, a blog or an IndieWeb post. Change the first person to suit.

> **TIMDA: a webring as objet d'art**
>
> Here's a thing I made, and it exists: https://timda.space
>
> TIMDA (Technocratic Incorporated Multi-node Digital Astrodrome) is a webring that has been taken a little too seriously. It's dressed as a retro-futurist space station, and it works as a living, interactive art installation. The hub is the station, and your site is a "Section" that docks to it. Each Section is its own room, in whatever tone its owner likes. Visitors wander between them, and the more Sections there are, the more inhabited the station feels. It's a webring that gets better, and stranger, as people add to it.
>
> **If you want to take part:**
> - Your Section is just your domain plus an SSH public key. No accounts, and you never have to name a person.
> - You opt in by publishing a few DNS TXT records under `_timda`. `timda plan` writes them for you in whatever format your DNS host wants.
> - You ask to dock with a signed request (`ssh-keygen -Y sign`), checked against your live DNS and reviewed by a human. After that, everything is optional: a button, a banner, an inbox.
>
> **The ground rules:** everything is opt-in, the hub sends no JavaScript to your browser, and the only sticky state is a hub's editorial delisting. Sections can be anonymous. The project isn't: it's maintained under a real name, and contributors use theirs.
>
> The specs, the CLI and the hub are open (code under MIT and AGPL, docs and site content under CC BY).
>
> - The station: https://timda.space
> - Specs, docs and CLI: https://github.com/timda-space/timda.space
> - The hub's code: https://github.com/timda-space/timda-website
>
> Kick the tires. If something's broken, confusing or just silly, yell at me. Feedback's welcome, in an issue or wherever you found this.

### A short post

For Mastodon and similar.

> I made a webring as objet d'art: https://timda.space. It's a retro-futurist space station you can dock your site to, and it gets more inhabited with every Section that joins. A few DNS records and a signed request, no accounts, no JavaScript, everything opt-in. Open source. Kick the tires and tell me what's broken.

Inboxes (TIMDA-3) are still a draft, so the sample posts don't promise mail between Sections.

## The button

The 88&times;31 launch button is original art, free to use on any TIMDA Section. Host your own copy, so visitors' browsers don't contact the hub until they click:

- [`timda-88x31.png`](../concepts/art/timda-88x31.png)
- [`timda-176x62.png`](../concepts/art/timda-176x62.png) (for sharp screens)

```html
<a href="https://timda.space/random"><img src="/timda-88x31.png"
  srcset="/timda-176x62.png 2x" width="88" height="31"
  alt="TIMDA: launch to a random Section"></a>
```

The station's own docking page, [timda.space/dock](https://timda.space/dock), has the same snippet, plus links to go round the ring.


## Before you post

- Check that your Section is docked and valid, with `timda finger <your-domain>`.
- The tools and the specs live here, so link to [the docking guide](docking.md) for anyone who wants to try it.
