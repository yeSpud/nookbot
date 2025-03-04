import parse from 'csv-parse/lib/sync'
import { CommandClient, TextChannel, Message, Role, Overwrite, Constants } from 'eris'

import { r } from '../../config/redis'
import { RedisClass } from '../../custom'
import { getReply } from '../../config/bot'

interface CsvCourse {
  COURSE_SUBJ_CODE: string
  COURSE_COURSE_CODE: string
  COURSE_TITLE: string
  COURSE_INSTRUCTOR: string
}

const moderatorOptions = {
  custom: (msg: Message<TextChannel>) => {
    return msg.member.roles.find(r => [
      process.env.CS_TEACHER,
      process.env.CS_ADMIN
    ].includes(r)) !== undefined
  }
}

const generateOverwrites = (role: string): Overwrite[] => {
  return [
    {
      // @everyone, allow none, deny read messages.
      id: process.env.CS_GUILD,
      type: Constants.PermissionOverwriteTypes.ROLE,
      allow: 0,
      deny: 1024
    },
    {
      // Teachers, allow mention everyone and manage messages, deny none
      id: process.env.CS_TEACHER,
      type: Constants.PermissionOverwriteTypes.ROLE,
      allow: 139264,
      deny: 0
    },
    {
      // Teaching assistants, same as Teachers
      id: process.env.CS_TEACHING_ASSISTANT,
      type: Constants.PermissionOverwriteTypes.ROLE,
      allow: 139264,
      deny: 0
    },
    // {
    //   // Muted, allow none, deny send messages
    //   id: process.env.CS_MUTED,
    //   type: Constants.PermissionOverwriteTypes.ROLE,
    //   allow: 0,
    //   deny: 2048
    // },
    {
      // Class role, allow read messages, deny none
      id: role,
      type: Constants.PermissionOverwriteTypes.ROLE,
      allow: 1024,
      deny: 0
    },
    {
      // Admin utility role, allow read messages, deny none
      id: process.env.CS_ADMIN_UTILITY,
      type: Constants.PermissionOverwriteTypes.ROLE,
      allow: 1024,
      deny: 0
    }
  ]
}

export const init = (bot: CommandClient): void => {
  bot.registerCommand('addclasses', async (msg, [parent]) => {
    const { guild } = msg.channel as TextChannel
    if (guild.channels.get(parent) === undefined) {
      await msg.channel.createMessage('Please provide a valid parent category ID')
      return
    }
    await msg.channel.sendTyping()
    const responses: string[] = []
    const courseCSV = msg.content.slice(msg.content.indexOf('\n')).trim()
    let courseList: CsvCourse[]
    try {
      courseList = parse(courseCSV, {
        columns: true
      })
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      await msg.channel.createMessage(`Invalid CSV provided.\n${err}`)
      return
    }

    for (const c of courseList) {
      // Make sure all required keys are present
      const requiredKeys = [
        'COURSE_SUBJ_CODE',
        'COURSE_COURSE_CODE',
        'COURSE_TITLE',
        'COURSE_INSTRUCTOR'
      ]
      if (!requiredKeys.every(k => Object.keys(c).includes(k))) {
        responses.push('Course is missing required keys')
        continue
      }

      const {
        COURSE_SUBJ_CODE: subject,
        COURSE_COURSE_CODE: course,
        COURSE_TITLE: title,
        COURSE_INSTRUCTOR: instructor
      } = c
      let role: Role | null = null
      let channel: TextChannel | null = null
      try {
        role = await guild.createRole({
          name: `${subject}${course} - ${instructor}`,
          permissions: 0
        })
        channel = await guild.createChannel(
          `${subject}${course}`,
          0,
          {
            parentID: parent,
            permissionOverwrites: generateOverwrites(role.id)
          }
        )
        await r.lpush('class.list', role.id)
        await r.set(`class:${role.id}`, JSON.stringify({
          channel: channel.id,
          subject,
          course,
          title,
          instructor
        }))
        responses.push(`Added ${role.mention}`)
      } catch (err) {
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        responses.push(`Error adding ${subject}${course}: ${err}`)
        if (role !== null) {
          await r.lrem('class.list', 0, role.id)
          await r.del(`class:${role.id}`)
          await role.delete('Error cleaning up')
        }
        if (channel !== null) {
          await channel.delete()
        }
      }
    }

    // Split response into multiple messages
    // Due to the amount of data returned by this command, it is likely to
    // exceed the 2000 character limit for bots.
    let replyString = ''
    for (const response of responses) {
      if (replyString.length + response.length > 2000) {
        await msg.channel.createMessage(replyString)
        replyString = response + '\n'
      } else {
        replyString += response + '\n'
      }
    }
    await msg.channel.createMessage(replyString)
  }, {
    description: 'Add classes in bulk from a CSV file',
    fullDescription: 'Required fields are `COURSE_SUBJ_CODE,COURSE_COURSE_CODE,COURSE_SECTION_NUMBER,COURSE_TITLE,COURSE_INSTRUCTOR`',
    requirements: moderatorOptions,
    guildOnly: true
  })

  bot.registerCommand('sync', async msg => {
    const typing = msg.channel.sendTyping()
    const classes = await r.lrange('class.list', 0, -1)
    const { guild } = msg.channel as TextChannel
    const classPromises = classes.map(async c => {
      const classJson = await r.get(`class:${c}`) as string
      const classChannelId = JSON.parse(classJson).channel as string
      const classChannel = guild.channels.get(classChannelId)
      if (classChannel !== undefined) {
        const overwrites = generateOverwrites(c)
        for (const ow of overwrites) {
          await classChannel.editPermission(ow.id, ow.allow, ow.deny, ow.type, 'Syncing class channels')
        }
      }
    })
    await Promise.all([typing, ...classPromises])
    await msg.channel.createMessage('Done')
  }, {
    description: 'Sync class channel permissions to the latest defined in the source.',
    requirements: moderatorOptions,
    guildOnly: true
  })

  bot.registerCommand('merge', async (msg, args) => {
    if (args.length !== 2) {
      await msg.channel.createMessage('Invalid usage.')
      return
    }
    const [to, from] = await Promise.all(args.map(async id => JSON.parse(await r.get(`class:${id}`) as string) as RedisClass))
    const [toId, fromId] = args
    if (to === null) {
      await msg.channel.createMessage(`Class ${toId} not found`)
      return
    }
    if (from === null) {
      await msg.channel.createMessage(`Class ${fromId} not found`)
      return
    }

    // Make sure that these are the classes that they actually want to merge
    const confirmationText = `${from.subject}-${from.course}-${from.section}>${to.subject}-${to.course}-${to.section}`
    await msg.channel.createMessage(`Are you sure you want to merge ${from.subject}-${from.course}-${from.section} into ${to.subject}-${to.course}-${to.section}?\nReply with \`${confirmationText}\` to confirm.`)
    const confirmation = await getReply(msg.channel, msg.author)

    if (confirmation.content !== confirmationText) {
      await msg.channel.createMessage('Confirmation does not match, not merging classes.')
      return
    }

    const { guild } = msg.channel as TextChannel
    await Promise.all(guild.members.map(async m => {
      if (m.roles.includes(fromId)) {
        await m.addRole(toId, 'Class migration')
      }
    }))
    const classJson = await r.get(`class:${fromId}`) as string
    const fromClass = JSON.parse(classJson) as RedisClass
    try {
      await Promise.all([
        guild.deleteRole(fromId),
        (guild.channels.get(fromClass.channel) as TextChannel).delete(),
        r.lrem('class.list', 0, fromId),
        r.del(`class:${fromId}`)
      ])
    } catch {}
    await msg.channel.createMessage('Classes merged.')
  }, {
    description: 'Merge two classes.',
    fullDescription: 'The first class will be the one to stay. The second will have all students moved to the first and will be destroyed.',
    usage: 'to-id from-id',
    requirements: moderatorOptions,
    guildOnly: true
  })

  bot.registerCommand('deleteclass', async (msg, args) => {
    const [classId] = args
    const classMetadata = JSON.parse(await r.get(`class:${classId}`) as string) as RedisClass
    if (classMetadata === null) {
      await msg.channel.createMessage('Class not found')
      return
    }

    // Make sure they actually want to delete this course
    const confirmationText = `${classMetadata.subject}-${classMetadata.course}-${classMetadata.section}`
    await msg.channel.createMessage(`Are you sure you want to delete ${confirmationText} course? Reply with \`${confirmationText}\``)
    const confirmation = await getReply(msg.channel, msg.author)

    if (confirmation.content !== confirmationText) {
      await msg.channel.createMessage('Confirmation does not match, not deleting course.')
      return
    }

    const { guild } = msg.channel as TextChannel
    try {
      await Promise.all([
        guild.deleteRole(classId),
        (guild.channels.get(classMetadata.channel) as TextChannel).delete(),
        r.lrem('class.list', 0, classId),
        r.del(`class:${classId}`)
      ])
    } catch {}
    await msg.channel.createMessage('Class deleted.')
  }, {
    description: 'Delete a class',
    requirements: moderatorOptions,
    guildOnly: true
  })

  bot.registerCommand('cleanup', async msg => {
    const courseIDs = await r.lrange('class.list', 0, -1)
    const promiseDetails = courseIDs.map(async c => ({ id: c, raw: await r.get(`class:${c}`) as string }))
    const details = await Promise.all(promiseDetails)
    const courses = details.map(c => ({ id: c.id, ...JSON.parse(c.raw) as RedisClass }))

    const confirmationText = Math.floor(Math.random() * 100000).toString()

    // Make sure that this is intended
    await msg.channel.createMessage(`Are you sure you want to delete all ${courses.length} course channels? Reply with \`${confirmationText}\``)
    const confirmation = await getReply(msg.channel, msg.author)

    if (confirmation.content !== confirmationText) {
      await msg.channel.createMessage('Confirmation does not match, not running cleanup.')
      return
    }

    await msg.channel.sendTyping()

    const { guild } = msg.channel as TextChannel
    await Promise.all(courses.map(async c => {
      try {
        await Promise.all([
          guild.deleteRole(c.id),
          (guild.channels.get(c.channel) as TextChannel).delete(),
          r.lrem('class.list', 0, c.id),
          r.del(`class:${c.id}`)
        ])
      } catch {}
    }))
    await msg.channel.createMessage('Cleanup complete.')
  }, {
    description: 'Delete all class channels for end of semester cleanup. This is a *very* destructive operation.',
    requirements: moderatorOptions,
    guildOnly: true
  })

  bot.registerCommand('registersubject', async (msg, args) => {
    if (args[0] === undefined) {
      await msg.channel.createMessage('Please provide a subject code.')
      return
    }

    const subjectCode = args.join(' ')

    const { guild } = msg.channel as TextChannel
    const role = await guild.createRole({
      name: subjectCode,
      permissions: 0
    })

    await r.set(`subject:${role.id}`, subjectCode)
    await r.lpush('subject.list', role.id)

    await msg.channel.createMessage(`Successfully created subject role ${role.mention}.`)
  }, {
    description: 'Create a role for a role for a subject.',
    requirements: moderatorOptions,
    guildOnly: true
  })
}

export default {
  init
}
