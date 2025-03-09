const mongoose = require("mongoose");
require("dotenv").config();

async function conectarDB() {
    try {
        await mongoose.connect(process.env.MONGO_URI, {
        });
        console.log("Conectado a MongoDB");
    } catch (error) {
        console.error("Error al conectar a MongoDB:", error);
    }
}

module.exports = conectarDB;
