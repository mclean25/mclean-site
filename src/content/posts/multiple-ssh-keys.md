---
slug: "/posts/multiple-git-ssh-keys"
pubDate: "2020-11-07"
title: "Multiple Git SSH Keys"
description: "How to configure using mutliple SSH keys on one machine"
---

## Intro

What I imagine a fairly common scenario for many git users is the need to use
different ssh keys when dealing with different repositories on your machine. I
ran into a few difficulties when I needed to do this to be able to use git for
both personal and work accounts on the same machine so I thought I would share
what worked for me here.

## Naming your ssh keys

When creating your ssh keys, I recommend saving them with more descriptive names
than the usual `id_ed25519` or whatever the default is for the type of key
you're creating. if you've already created them, you can simply just rename the
files afterwards; just make sure the `.pub` and private names match (eg:
`work_key.pub` & `work_key`).

## Setting up your config

Now that you have both of your keys named to something obvious, you'll want to
add a new file in your `~/.ssh/` directory called `config`:

###### ` ~/.ssh/config`

```py
Host *
    # yes if keys should be added to ssh agent
    AddKeysToAgent yes
    # yes if key pass phrase should be added to key chain
    # I think this should always equal the AddKeysToAgent bool?
    IgnoreUnknown UseKeychain
    UseKeychain yes
    # Specifies that ssh should only use the authentication identity
    # files configured in the ssh_config files, even if ssh-agent offers
    # more identities.
    # Default is no but adding it specifically for history
    IdentitiesOnly no
    User git

# work account
Host gitlab.com-work
    HostName gitlab.com
    IdentityFile ~/.ssh/work_key

# personal account
Host github.com
    HostName github.com
    IdentityFile ~/.ssh/personal_key
```

The settings within the global host section (`Host *`) adds your keys to your
ssh-agent, which means that you only have to add your passphrase for the key
on your first use. After that, the ssh-agent will handle the passphrase for you
so you don't need to enter it again.

The more relevant parts of this file for the context of this post are the `Host
gitlab.com-work` and `Host github.com` sections. For my self, my work's git
repository is hosted on GitLab while I use GitHub for my personal projects. Note
that the host for GitLab is normally `gitlab.com`, but I've post-fixed it with
`-work`. This effectively allows me to tag repositories when I'm cloning them to
use one key or the other.

## Cloning repositories

Now when I clone something from GitLab, instead of:

    git clone git@gitlab.com:${username}/${project-slug}

I'd do:

    git clone git@gitlab.com-work:${username}/${project-slug}

For my GitHub repositories, I don't need to change anything:

    git clone git@github.com:${username}/${project-slug}

## Setting up existing repositories

If you've already cloned some repositories and are just setting this up now, you
can simply edit the `.git/config` file within the repository to get the desired
effect. Open the `.git/config` file with your editor and change the url variable
in the `[remote "origin"]` section as we did above.

```diff
[remote "origin"]
-       url = git@gitlab.com:${project}.git
+       url = git@gitlab.com-work:${project}.git
```
