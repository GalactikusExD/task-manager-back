const express = require("express");
const cors = require("cors");
const conectarDB = require("./database");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const Task = require("./models/Task");
const User = require("./models/User");
const Group = require("./models/Group");

require("dotenv").config();

conectarDB();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

const authenticate = (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).json({ error: "Acceso denegado. Token no proporcionado." });
  }

  try {
    const decoded = jwt.verify(token.split(" ")[1], process.env.JWT_SECRET || "secret-key");
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: "Token inválido" });
  }
};

app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: "El usuario ya existe" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({ username, email, password: hashedPassword });
    await newUser.save();

    res.status(201).json({ message: "Usuario registrado correctamente", user: newUser });
  } catch (error) {
    res.status(500).json({ error: "Error al registrar usuario", details: error.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: "Usuario no encontrado" });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: "Contraseña incorrecta" });
    }

    user.last_login = new Date();
    await user.save();

    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET || "secret-key",
      { expiresIn: "10m" }
    );
    console.log("Token generado:", token);

    res.json({ message: "Inicio de sesión exitoso", token, user });
  } catch (error) {
    res.status(500).json({ error: "Error al iniciar sesión", details: error.message });
  }
});

app.get("/api/currentUser", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("-password");
    if (!user) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }
    res.json(user);
  } catch (error) {
    console.error("Error al obtener usuario:", error);
    res.status(500).json({ error: "Error al obtener usuario", details: error.message });
  }
});

app.post("/api/tasks", authenticate, async (req, res) => {
  try {
    const { nametask, description, dead_line, remind_me, status, category, groupId } = req.body;

    if (!nametask || !description || !status) {
      return res.status(400).json({ error: "Faltan datos obligatorios" });
    }

    if (groupId) {
      const group = await Group.findById(groupId);
      if (!group) {
        return res.status(404).json({ error: "Grupo no encontrado" });
      }

      if (group.createdBy.toString() !== req.user.userId) {
        return res.status(403).json({ error: "Solo el creador del grupo puede asignar tareas" });
      }
    }

    const newTask = new Task({
      nametask,
      description,
      dead_line,
      remind_me,
      status,
      category,
      createdBy: req.user.userId,
      group: groupId || null,
    });

    await newTask.save();
    res.status(201).json({ message: "Tarea creada con éxito", task: newTask });
  } catch (error) {
    console.error("Error al crear la tarea:", error);
    res.status(500).json({ error: "Error al crear la tarea", details: error.message });
  }
});

app.get("/api/tasks", authenticate, async (req, res) => {
    try {
      const userGroups = await Group.find({
        members: req.user.userId,
      });
  
      const groupIds = userGroups.map((group) => group._id);
  
      const tasks = await Task.find({
        $or: [
          { createdBy: req.user.userId },
          { group: { $in: groupIds } },
        ],
      })
        .populate("createdBy", "username email")
        .populate("group", "members createdBy");
  
      res.status(200).json(tasks);
    } catch (error) {
      console.error("Error al obtener las tareas:", error);
      res.status(500).json({ error: "Error al obtener las tareas", details: error.message });
    }
  });

app.put("/api/tasks/:taskId/status", authenticate, async (req, res) => {
  try {
    const { taskId } = req.params;
    const { status } = req.body;

    const task = await Task.findById(taskId).populate("group");
    if (!task) {
      return res.status(404).json({ error: "Tarea no encontrada" });
    }

    if (task.createdBy.toString() !== req.user.userId && (!task.group || !task.group.members.includes(req.user.userId))) {
      return res.status(403).json({ error: "No tienes permisos para editar esta tarea" });
    }

    task.status = status;
    await task.save();

    res.json({ message: "Estado de la tarea actualizado", task });
  } catch (error) {
    console.error("Error al actualizar el estado de la tarea:", error);
    res.status(500).json({ error: "Error al actualizar el estado de la tarea", details: error.message });
  }
});

app.get("/api/users", authenticate, async (req, res) => {
  try {
    const users = await User.find({}, "username email role");
    res.json(users);
  } catch (error) {
    console.error("Error al obtener usuarios:", error);
    res.status(500).json({ error: "Error al obtener usuarios" });
  }
});

app.put("/api/users/:userId", authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;

    const user = await User.findByIdAndUpdate(userId, { role }, { new: true });
    if (!user) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    res.json({ message: "Usuario actualizado correctamente", user });
  } catch (error) {
    console.error("Error al actualizar el usuario:", error);
    res.status(500).json({ error: "Error al actualizar el usuario", details: error.message });
  }
});

app.post("/api/groups", authenticate, async (req, res) => {
  try {
    const { name, members } = req.body;

    const membersWithCreator = [...new Set([...members, req.user.userId])];

    const newGroup = new Group({
      name,
      members: membersWithCreator,
      createdBy: req.user.userId,
    });

    await newGroup.save();
    res.status(201).json({ message: "Grupo creado con éxito", group: newGroup });
  } catch (error) {
    console.error("Error al crear el grupo:", error);
    res.status(500).json({ error: "Error al crear el grupo", details: error.message });
  }
});

app.get("/api/groups/me", authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;

    const groups = await Group.find({
      $or: [{ members: userId }, { createdBy: userId }],
    })
      .populate("members", "username email")
      .populate("createdBy", "username email");

    res.status(200).json(groups);
  } catch (error) {
    console.error("Error al obtener los grupos del usuario:", error);
    res.status(500).json({ error: "Error al obtener los grupos del usuario", details: error.message });
  }
});

app.delete("/api/groups/:groupId", authenticate, async (req, res) => {
  try {
    const { groupId } = req.params;

    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ error: "Grupo no encontrado" });
    }

    if (group.createdBy.toString() !== req.user.userId) {
      return res.status(403).json({ error: "Solo el creador del grupo puede eliminarlo" });
    }

    await Group.findByIdAndDelete(groupId);
    res.json({ message: "Grupo eliminado con éxito" });
  } catch (error) {
    console.error("Error al eliminar el grupo:", error);
    res.status(500).json({ error: "Error al eliminar el grupo", details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});