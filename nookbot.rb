require 'discordrb'
require 'net/https'
require 'json'
TOKEN = ENV['DISCORD_API_TOKEN']
SERVER_ID = 478810581273673746
CLASS_CATEGORY_ID = 478815208035581978

discord = Discordrb::Commands::CommandBot.new token: TOKEN, prefix: '!'
discord.run :async

server = discord.servers[SERVER_ID]

def is_admin_or_teacher(user)
  result = false
  user.roles.each do |role|
    if role.permissions.administrator || role.name == "Teacher" then
      result = true
    end
  end
  return result
end


discord.command(:createclass, description: 'Creates a new class chat', usage: 'createclass cs123') do |event, class_id_raw|
  if is_admin_or_teacher event.user
    class_id = class_id_raw.downcase.chomp
    class_role = server.create_role name: "class-#{ class_id }"
    everyone_role = server.roles.find { |r| r.name == '@everyone' }

    read_messages = Discordrb::Permissions.new
    read_messages.can_read_messages = true

    class_role_overwrite = Discordrb::Overwrite.new class_role, allow: read_messages
    everyone_role_overwrite = Discordrb::Overwrite.new everyone_role, deny: read_messages
    
    server.create_channel class_id, 0, permission_overwrites: [class_role_overwrite, everyone_role_overwrite], parent: CLASS_CATEGORY_ID
    return "Channel created"
  else
    return "You don't have permission to use this command."
  end
end


discord.command(:destroyclass, description: 'Destroys an existing class chat', usage: 'destroyclass cs123') do |event, class_id_raw|
  if is_admin_or_teacher event.user
    class_id = class_id_raw.downcase.chomp
    channel = server.channels.find { |r| r.name == class_id }
    if channel.parent_id != CLASS_CATEGORY_ID
      return "Not a valid class chat"
    end
    channel.delete
    server.roles.find { |r| r.name == "class-#{ class_id }" }.delete
    return "Channel deleted"
  else
    return "You don't have permission to use this command."
  end
end


discord.command(:joinclass, description: 'Adds you to a class chat', usage: 'joinclass cs123') do |event, class_id_raw|
  class_id = class_id_raw.downcase.chomp
  class_channel_names = server.channels.select { |c| c.parent_id == CLASS_CATEGORY_ID }.map {|c| c.name}
  if class_channel_names.include? class_id
    role = server.roles.select { |r| r.name == "class-#{ class_id }" }
    event.user.modify_roles(role, [], nil)
    return 'Done'
  else
    return 'Invalid class id'
  end
end


discord.command(:dropclass, description: 'Removes you from a class chat', usage: 'dropclass cs123') do |event, class_id_raw|
  class_id = class_id_raw.downcase.chomp
  class_channel_names = server.channels.select { |c| c.parent_id == CLASS_CATEGORY_ID }.map {|c| c.name}
  if class_channel_names.include? class_id
    role = server.roles.select { |r| r.name == "class-#{ class_id }" }
    event.user.modify_roles([], role, nil)
    return 'Done'
  else
    return 'Invalid class id'
  end
end

discord.command(:roll, description: 'Performs a dice roll', usage: 'roll 20') do |event, dice|
  highest_number = Integer(dice) rescue nil
  if highest_number
    return rand(1..highest_number)
  else
    return 'Proper usage is !roll 20'
   end
end

discord.command(:cat, description: "Gives random cat", usage: 'cat') do |event|
  url = 'https://aws.random.cat/meow'
  uri = URI(url)
  response = Net::HTTP.get(uri)
  random_kitty = JSON.parse(response)["file"]
  event.channel.send_embed do |embed|
   embed.image = Discordrb::Webhooks::EmbedImage.new(url: random_kitty)
  end
end

discord.command(:classes, description: 'Lists classes', usage: 'classes') do |event|
  message = "Currently available class channels:\n"
  server.channels.select { |c| c.parent_id == CLASS_CATEGORY_ID }.each do |c|
    message << "* #{ c.name }\n"
  end
  return message
end

discord.command(:source, description: 'Tells you where to find the source code', usage: 'source') do |event|
  "https://github.com/FineTralfazz/NookBot"
end

discord.command(:hotdog,description: "Gives a hotdog", usage: 'hotdog') do |event|
  event.channel.send_embed do |embed|
    embed.image = Discordrb::Webhooks::EmbedImage.new(url: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fb/Hotdog_-_Evan_Swigart.jpg/1200px-Hotdog_-_Evan_Swigart.jpg")
  end
end

discord.command(:insult,description: "Insults a user", usage: "insult @user") do |event, target|
  url = 'https://evilinsult.com/generate_insult.php?lang=en&type=json'
  uri = URI(url)
  response = Net::HTTP.get(uri)
  insult = JSON.parse(response)["insult"]
  if target.nil?
    event.channel.send_message(event.author.mention + ' ' + insult)
  else
    event.channel.send_message(target + ' ' +  insult)
  end

end

discord.member_join do|event|
  event.user.pm.send_embed do |embed|
    embed.title = "Welcome to the UAF CS Discord! Here's some important info to get you started on the server."
    embed.colour = 0x38a4f4


    embed.add_field(name: "📛", value: "First thing's first, we need to know who you are! Message one of the admins(the people in yellow on the right when you're in the server) and tell them who you are")
    embed.add_field(name: "🏷️", value: "Next you need to set your name! If you're on a computer right clicking yourself while in the server and selecting 'change nickname' will let you set your name for the server")
    embed.add_field(name: "📚", value: "Lastly, you can join specific class chats with the help of our resident NookBot. You can type the !classes command to see available classes and !joinclass (class-name) to join that class. Make sure you do all NookBot commands within the 'NookBot Den' channel.")
    embed.add_field(name: "P.S.",value: "For all other rules ask an admin or see the server-rules channel")
  end
end

discord.listening = '!help'
discord.sync
